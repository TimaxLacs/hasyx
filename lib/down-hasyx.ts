import fs from 'fs-extra';
import path from 'path';
import spawn from 'cross-spawn';
import { Hasura } from './hasura';
import Debug from './debug';

const debug = Debug('migration:down-hasyx');

async function runHasyxSchemaCommand(projectRoot: string): Promise<void> {
  debug('Running "npx hasyx schema"...');
  const result = spawn.sync('npx', ['hasyx', 'schema'], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  if (result.error) {
    debug('Failed to run "npx hasyx schema":', result.error);
    throw new Error(`Failed to run "npx hasyx schema": ${result.error.message}`);
  }
  if (result.status !== 0) {
    debug('"npx hasyx schema" command failed with status:', result.status);
    throw new Error(`"npx hasyx schema" command failed with status ${result.status}`);
  }
  debug('"npx hasyx schema" command completed successfully.');
}

interface HasuraTable {
  table: {
    schema: string;
    name: string;
  };
  primary_key?: {
    columns: string[];
  } | null;
}

// Helper to extract relevant table information from GraphQL schema types (consistent with up-hasyx)
function getTablesFromGraphQLSchema(schemaTypes: any[]): HasuraTable[] {
  const tables: HasuraTable[] = [];
  if (!Array.isArray(schemaTypes)) {
    debug('Schema types is not an array, cannot extract tables.');
    return tables;
  }

  for (const type of schemaTypes) {
    if (type.kind === 'OBJECT' && type.name && !type.name.startsWith('__') && type.fields) {
      if (type.name.endsWith('_aggregate') || 
          type.name.endsWith('_avg_fields') || 
          type.name.endsWith('_max_fields') || 
          type.name.endsWith('_min_fields') || 
          type.name.endsWith('_stddev_fields') || 
          type.name.endsWith('_stddev_pop_fields') || 
          type.name.endsWith('_stddev_samp_fields') || 
          type.name.endsWith('_sum_fields') || 
          type.name.endsWith('_var_pop_fields') || 
          type.name.endsWith('_var_samp_fields') || 
          type.name.endsWith('_variance_fields') ||
          type.name === 'query_root' || 
          type.name === 'mutation_root' || 
          type.name === 'subscription_root') {
        continue;
      }
      tables.push({
        table: {
          schema: 'public', // ASSUMPTION
          name: type.name
        }
        // For DOWN script, primary_key info from here isn't strictly needed for dropping columns/relationships by name
      });
    }
  }
  debug(`Extracted ${tables.length} potential tables from GraphQL schema types for cleanup.`);
  return tables;
}

export async function down(): Promise<boolean> {
  const projectRoot = process.cwd();
  debug('🚀 Starting Hasyx View migration DOWN...');

  if (!process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL || !process.env.HASURA_ADMIN_SECRET) {
    console.error('❌ Hasura URL or Admin Secret not found in environment variables.');
    debug('Missing Hasura credentials in .env');
    return false;
  }

  const hasura = new Hasura({
    url: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL!,
    secret: process.env.HASURA_ADMIN_SECRET!,
  });

  try {
    await runHasyxSchemaCommand(projectRoot);

    const schemaPath = path.join(projectRoot, 'public', 'hasura-schema.json');
    let tablesToClean: HasuraTable[] = [];

    if (!fs.existsSync(schemaPath)) {
      console.warn(`⚠️ Hasura schema file not found at ${schemaPath}. Skipping schema-dependent cleanup steps (columns, relationships by name).`);
    } else {
      try {
        const rawSchemaFileContent = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
        if (rawSchemaFileContent && rawSchemaFileContent.data && rawSchemaFileContent.data.__schema && rawSchemaFileContent.data.__schema.types) {
          tablesToClean = getTablesFromGraphQLSchema(rawSchemaFileContent.data.__schema.types);
           if (tablesToClean.length === 0) {
             console.warn(`⚠️ Parsed GraphQL schema but found no suitable table objects in data.__schema.types to clean up. Check filter logic.`);
          }
        } else {
          console.warn(`⚠️ Hasura schema file at ${schemaPath} does not have the expected structure (data.__schema.types). Skipping schema-dependent cleanup.`);
          debug('Unexpected schema file content for down script:', rawSchemaFileContent);
        }
      } catch (parseError: any) {
        console.error(`❌ Error parsing ${schemaPath}: ${parseError.message}. Skipping schema-dependent cleanup.`);
        debug('JSON parse error for schema file (down script): ', parseError);
      }
    }

    for (const tableDef of tablesToClean) {
      const schemaName = tableDef.table.schema; // Assumed public
      const tableName = tableDef.table.name;

      if (tableName === 'hasyx' && schemaName === 'public') continue;
 
      const relToHasyxName = 'hasyx';
      debug(`Dropping relationship ${relToHasyxName} from ${schemaName}.${tableName}`);
      try {
        await hasura.v1({
          type: 'pg_drop_relationship',
          args: {
            source: 'default',
            table: { schema: schemaName, name: tableName },
            relationship: relToHasyxName,
          },
        });
      } catch (e: any) {
        debug(`Failed to drop relationship ${relToHasyxName} from ${schemaName}.${tableName} (may not exist):`, e.message);
      }

      const dropColsSql = `
        ALTER TABLE IF EXISTS "${schemaName}"."${tableName}"
        DROP COLUMN IF EXISTS "_hasyx_schema_name",
        DROP COLUMN IF EXISTS "_hasyx_table_name";`;
      debug('Dropping generated columns from ' + schemaName + '.' + tableName + ':\n' + dropColsSql);
      await hasura.sql(dropColsSql);
      
      // Dropping relationship from hasyx view back to this table
      const relFromHasyxName = `${schemaName}_${tableName}`;
      debug(`Dropping relationship ${relFromHasyxName} from public.hasyx to ${schemaName}.${tableName}`);
      try {
          await hasura.v1({
              type: 'pg_drop_relationship',
              args: {
                  source: 'default',
                  table: { schema: 'public', name: 'hasyx' }, 
                  relationship: relFromHasyxName,
              },
          });
      } catch (e: any) {
          debug(`Failed to drop relationship ${relFromHasyxName} from public.hasyx (may not exist):`, e.message);
      }
    }
    
    debug('Untracking view public.hasyx...');
    try {
        await hasura.v1({
          type: 'pg_untrack_table',
          args: {
            source: 'default',
            table: { schema: 'public', name: 'hasyx' },
            cascade: true, // Cascade true here should help clean up relationships defined *on* the view if any were missed by explicit deletion
          },
        });
    } catch (e: any) {
        debug('Failed to untrack public.hasyx (may not exist or already untracked):', e.message);
    }

    const dropViewSql = 'DROP VIEW IF EXISTS "public"."hasyx";';
    debug('Dropping view public.hasyx...\n' + dropViewSql);
    await hasura.sql(dropViewSql);
    
    await runHasyxSchemaCommand(projectRoot);

    debug('✨ Hasyx View migration DOWN completed successfully!');
    return true;
  } catch (error: any) {
    console.error('❗ Critical error during Hasyx View DOWN migration:', error.message);
    debug('❌ Hasyx View DOWN Migration failed:', error);
    return false;
  }
} 