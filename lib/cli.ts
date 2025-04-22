#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import spawn from 'cross-spawn';

// Use CommonJS globals __filename and __dirname
// const __filename = fileURLToPath(import.meta.url); // No longer needed
// const __dirname = path.dirname(__filename); // Use global __dirname
// const require = createRequire(import.meta.url); // No longer needed

// --- Templates --- (Store template content or paths here)
// It's better to load these from actual files for maintainability
const templatesDir = path.resolve(__dirname, '../../'); // Assuming templates are in dist/../templates

const getTemplateContent = (fileName: string): string => {
  const filePath = path.join(templatesDir, fileName);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading template file: ${filePath}`, error);
    throw new Error(`Template file not found: ${fileName}`);
  }
};

// --- CLI Setup ---
const program = new Command();

// Function to find project root (where package.json is)
const findProjectRoot = (startDir: string = process.cwd()): string => {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error("Could not find project root (package.json). Are you inside a Node.js project?");
};

// --- `init` Command ---
program
  .command('init')
  .description('Initialize hasyx authentication and GraphQL proxy in a Next.js project.')
  .action(async () => {
    console.log('🚀 Initializing hasyx...');
    const projectRoot = findProjectRoot();
    const targetDir = projectRoot;

    const filesToCreateOrReplace = {
      // API Routes (will overwrite)
      'app/api/auth/[...nextauth]/route.ts': 'app/api/auth/[...nextauth]/route.ts',
      'app/api/auth/[...nextauth]/options.ts': 'app/api/auth/[...nextauth]/options.ts',
      'app/api/auth/verify/route.ts': 'app/api/auth/verify/route.ts',
      'app/api/graphql/route.ts': 'app/api/graphql/route.ts',
    };

    const filesToCreateIfNotExists = {
      // Basic Next.js structure (won't overwrite)
      'app/layout.tsx': 'app/layout.tsx',
      'app/page.tsx': 'app/page.tsx',
      'app/globals.css': 'app/globals.css',
      'app/favicon.ico': 'app/favicon.ico', // Need binary template handling or skip
      // Config files (won't overwrite)
      '.gitignore': '.gitignore',
      '.npmignore': '.npmignore',
    };

    // Ensure directories exist
    const ensureDirs = [
      'app/api/auth/[...nextauth]',
      'app/api/auth/verify',
      'app/api/graphql',
    ];
    for (const dir of ensureDirs) {
      await fs.ensureDir(path.join(targetDir, dir));
      console.log(`✅ Ensured directory exists: ${dir}`);
    }

    // Create/Replace files
    for (const [targetPath, templateName] of Object.entries(filesToCreateOrReplace)) {
      const fullTargetPath = path.join(targetDir, targetPath);
      const templateContent = getTemplateContent(templateName);
      await fs.writeFile(fullTargetPath, templateContent);
      console.log(`✅ Created/Replaced: ${targetPath}`);
    }

    // Create files if they don't exist
    for (const [targetPath, templateName] of Object.entries(filesToCreateIfNotExists)) {
      const fullTargetPath = path.join(targetDir, targetPath);
      if (!fs.existsSync(fullTargetPath)) {
          // Special handling for favicon (binary)
          if (targetPath.endsWith('favicon.ico')) {
             const templatePath = path.join(templatesDir, templateName);
             try {
                await fs.copyFile(templatePath, fullTargetPath);
                console.log(`✅ Created: ${targetPath}`);
             } catch (copyError) {
                console.warn(`⚠️ Could not copy favicon template: ${copyError}`);
             }
          } else {
            const templateContent = getTemplateContent(templateName);
            await fs.writeFile(fullTargetPath, templateContent);
            console.log(`✅ Created: ${targetPath}`);
          }
      } else {
        console.log(`⏩ Skipped (already exists): ${targetPath}`);
      }
    }

    // Check for hasyx dependency (informational only for now)
    try {
        const pkgJsonPath = path.join(projectRoot, 'package.json');
        const pkgJson = await fs.readJson(pkgJsonPath);
        if (!pkgJson.dependencies?.hasyx && !pkgJson.devDependencies?.hasyx) {
            console.warn(`
⚠️ Warning: 'hasyx' package not found in your project dependencies.
  Please install it manually: npm install hasyx
            `);
        } else {
             console.log("✅ 'hasyx' package found in dependencies.");
        }
    } catch (err) {
         console.warn("⚠️ Could not check package.json for hasyx dependency.");
    }

    console.log('✨ hasyx initialization complete!');
    console.log('👉 Next steps:');
    console.log('   1. Fill in your .env file with necessary secrets (Hasura, NextAuth, OAuth, etc.).');
    console.log('   2. Apply Hasura migrations and metadata if not already done.');
    console.log('   3. Run `npx hasyx dev` to start the development server.');
  });

// --- `dev` Command ---
program
  .command('dev')
  .description('Starts the Next.js development server with WebSocket support.')
  .action(() => {
    console.log('🚀 Starting development server (using next dev)...');
    // Run next dev directly
    const result = spawn.sync('npx', ['next', 'dev'], {
      stdio: 'inherit', // Show output in console
      cwd: findProjectRoot(),
    });
    if (result.error) {
      console.error('❌ Failed to start development server:', result.error);
      process.exit(1);
    }
    if (result.status !== 0) {
       console.error(`❌ Development server exited with status ${result.status}`);
       process.exit(result.status ?? 1);
    }
  });

// --- `build` Command ---
program
  .command('build')
  .description('Builds the Next.js application for production.')
  .action(() => {
    console.log('🏗️ Building Next.js application...');
    const result = spawn.sync('npx', ['next', 'build'], {
      stdio: 'inherit',
      cwd: findProjectRoot(),
    });
     if (result.error) {
      console.error('❌ Build failed:', result.error);
      process.exit(1);
    }
    if (result.status !== 0) {
       console.error(`❌ Build process exited with status ${result.status}`);
       process.exit(result.status ?? 1);
    }
    console.log('✅ Build complete!');
  });

// --- `start` Command ---
program
  .command('start')
  .description('Starts the Next.js production server (uses custom server.js).')
  .action(() => {
    console.log('🛰️ Starting production server (using next start)...');
    // Run next start directly
     const result = spawn.sync('npx', ['next', 'start'], {
      stdio: 'inherit',
      cwd: findProjectRoot(),
      // NODE_ENV should be set by 'next start' automatically
      // env: { ...process.env, NODE_ENV: 'production' }, 
    });
    if (result.error) {
      console.error('❌ Failed to start production server:', result.error);
      process.exit(1);
    }
    if (result.status !== 0) {
       console.error(`❌ Production server exited with status ${result.status}`);
       process.exit(result.status ?? 1);
    }
  });

program.parse(process.argv); 