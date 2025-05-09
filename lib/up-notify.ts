import dotenv from 'dotenv';
import path from 'path';
import { Hasura } from './hasura';
import Debug from './debug';

// Initialize debug
const debug = Debug('migration:up-notify');

// SQL schema for notification tables
const sqlSchema = `
  -- Create notification_permissions table
  CREATE TABLE "public"."notification_permissions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "provider" text NOT NULL,
      "device_token" text NOT NULL,
      "device_info" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" timestamptz NOT NULL,
      "updated_at" timestamptz NOT NULL,
      PRIMARY KEY ("id"),
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE
  );

  -- Create indexes for notification_permissions
  CREATE INDEX "idx_notification_permissions_device_token" ON "public"."notification_permissions" ("device_token");
  CREATE INDEX "idx_notification_permissions_user_id" ON "public"."notification_permissions" ("user_id");

  -- Create notification_messages table
  CREATE TABLE "public"."notification_messages" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "title" text NOT NULL,
      "body" text NOT NULL,
      "data" jsonb DEFAULT NULL,
      "user_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL,
      PRIMARY KEY ("id"),
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE
  );

  -- Create indexes for notification_messages
  CREATE INDEX "idx_notification_messages_user_id" ON "public"."notification_messages" ("user_id");

  -- Create notifications table
  CREATE TABLE "public"."notifications" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "message_id" uuid NOT NULL,
      "permission_id" uuid NOT NULL,
      "config" jsonb DEFAULT NULL,
      "status" text NOT NULL DEFAULT 'pending',
      "error" text DEFAULT NULL,
      "created_at" timestamptz NOT NULL,
      "updated_at" timestamptz NOT NULL,
      PRIMARY KEY ("id"),
      FOREIGN KEY ("message_id") REFERENCES "public"."notification_messages"("id") ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY ("permission_id") REFERENCES "public"."notification_permissions"("id") ON UPDATE CASCADE ON DELETE CASCADE
  );

  -- Create indexes for notifications
  CREATE INDEX "idx_notifications_status" ON "public"."notifications" ("status");
  CREATE INDEX "idx_notifications_message_id" ON "public"."notifications" ("message_id");
  CREATE INDEX "idx_notifications_permission_id" ON "public"."notifications" ("permission_id");
`;

// RLS and permission policies
const rlsAndPoliciesSQL = `
  -- Notification permissions table RLS
  ALTER TABLE "public"."notification_permissions" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "users_can_see_own_permissions" ON "public"."notification_permissions";
  CREATE POLICY "users_can_see_own_permissions" ON "public"."notification_permissions"
      FOR SELECT USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "users_can_delete_own_permissions" ON "public"."notification_permissions";
  CREATE POLICY "users_can_delete_own_permissions" ON "public"."notification_permissions"
      FOR DELETE USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "users_can_insert_own_permissions" ON "public"."notification_permissions";
  CREATE POLICY "users_can_insert_own_permissions" ON "public"."notification_permissions"
      FOR INSERT WITH CHECK (user_id = auth.uid());

  -- Notification messages table RLS
  ALTER TABLE "public"."notification_messages" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "users_can_see_own_messages" ON "public"."notification_messages";
  CREATE POLICY "users_can_see_own_messages" ON "public"."notification_messages"
      FOR SELECT USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "users_can_insert_own_messages" ON "public"."notification_messages";
  CREATE POLICY "users_can_insert_own_messages" ON "public"."notification_messages"
      FOR INSERT WITH CHECK (user_id = auth.uid());

  -- Notifications table RLS
  ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "users_can_see_own_notifications" ON "public"."notifications";
  CREATE POLICY "users_can_see_own_notifications" ON "public"."notifications" FOR SELECT
      USING (
          EXISTS (
              SELECT 1 FROM notification_permissions
              WHERE notification_permissions.id = permission_id AND notification_permissions.user_id = auth.uid()
          )
      );

  DROP POLICY IF EXISTS "users_can_insert_own_notifications" ON "public"."notifications";
  CREATE POLICY "users_can_insert_own_notifications" ON "public"."notifications" FOR INSERT
      WITH CHECK (
          EXISTS (
              SELECT 1 FROM notification_permissions
              WHERE notification_permissions.id = permission_id AND notification_permissions.user_id = auth.uid()
          )
      );
`;

// SQL for granting permissions
const grantPermissionsSQL = `
  -- Grant permissions to HasuraAdmin role
  GRANT ALL ON "public"."notification_permissions" TO "HasuraAdmin";
  GRANT ALL ON "public"."notification_messages" TO "HasuraAdmin";
  GRANT ALL ON "public"."notifications" TO "HasuraAdmin";

  -- Grant permissions to user role
  GRANT SELECT, INSERT, DELETE ON "public"."notification_permissions" TO "user";
  GRANT SELECT, INSERT ON "public"."notification_messages" TO "user";
  GRANT SELECT, INSERT ON "public"."notifications" TO "user";
`;

// Tables to track in Hasura
const tablesToTrack = [
  { schema: 'public', name: 'notification_permissions' },
  { schema: 'public', name: 'notification_messages' },
  { schema: 'public', name: 'notifications' }
];

// Relationships to create
const relationships = [
  // User relationships
  {
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_permissions' },
      name: 'user',
      using: {
        foreign_key_constraint_on: 'user_id'
      }
    }
  },
  {
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_messages' },
      name: 'user',
      using: {
        foreign_key_constraint_on: 'user_id'
      }
    }
  },
  // Notification relationships
  {
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notifications' },
      name: 'message',
      using: {
        foreign_key_constraint_on: 'message_id'
      }
    }
  },
  {
    type: 'pg_create_object_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notifications' },
      name: 'permission',
      using: {
        foreign_key_constraint_on: 'permission_id'
      }
    }
  },
  // Reverse relationships
  {
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_permissions' },
      name: 'notifications',
      using: {
        foreign_key_constraint_on: {
          table: { schema: 'public', name: 'notifications' },
          column: 'permission_id'
        }
      }
    }
  },
  {
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_messages' },
      name: 'notifications',
      using: {
        foreign_key_constraint_on: {
          table: { schema: 'public', name: 'notifications' },
          column: 'message_id'
        }
      }
    }
  },
  {
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'users' },
      name: 'notification_permissions',
      using: {
        foreign_key_constraint_on: {
          table: { schema: 'public', name: 'notification_permissions' },
          column: 'user_id'
        }
      }
    }
  },
  {
    type: 'pg_create_array_relationship',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'users' },
      name: 'notification_messages',
      using: {
        foreign_key_constraint_on: {
          table: { schema: 'public', name: 'notification_messages' },
          column: 'user_id'
        }
      }
    }
  }
];

// Table select permissions for roles
const selectPermissions = [
  // User permissions
  {
    type: 'pg_create_select_permission',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_permissions' },
      role: 'user',
      permission: {
        columns: ['id', 'user_id', 'provider', 'device_token', 'device_info', 'created_at', 'updated_at'],
        filter: {
          user_id: { _eq: 'X-Hasura-User-Id' }
        }
      },
      comment: 'Users can select their own notification permissions'
    }
  },
  {
    type: 'pg_create_select_permission',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_messages' },
      role: 'user',
      permission: {
        columns: ['id', 'title', 'body', 'data', 'user_id', 'created_at'],
        filter: {
          user_id: { _eq: 'X-Hasura-User-Id' }
        }
      },
      comment: 'Users can select their own notification messages'
    }
  },
  {
    type: 'pg_create_select_permission',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notifications' },
      role: 'user',
      permission: {
        columns: ['id', 'message_id', 'permission_id', 'config', 'status', 'error', 'created_at', 'updated_at'],
        filter: {
          permission: {
            user_id: { _eq: 'X-Hasura-User-Id' }
          }
        }
      },
      comment: 'Users can select notifications linked to their permissions'
    }
  },
  // Admin permissions
  {
    type: 'pg_create_select_permission',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_permissions' },
      role: 'admin',
      permission: {
        columns: ['id', 'user_id', 'provider', 'device_token', 'device_info', 'created_at', 'updated_at'],
        filter: {}
      },
      comment: 'Admins can select all notification permissions'
    }
  },
  {
    type: 'pg_create_select_permission',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notification_messages' },
      role: 'admin',
      permission: {
        columns: ['id', 'title', 'body', 'data', 'user_id', 'created_at'],
        filter: {}
      },
      comment: 'Admins can select all notification messages'
    }
  },
  {
    type: 'pg_create_select_permission',
    args: {
      source: 'default',
      table: { schema: 'public', name: 'notifications' },
      role: 'admin',
      permission: {
        columns: ['id', 'message_id', 'permission_id', 'config', 'status', 'error', 'created_at', 'updated_at'],
        filter: {}
      },
      comment: 'Admins can select all notifications'
    }
  }
];

/**
 * Apply SQL schema for notification tables
 */
export async function applySQLSchema(hasura: Hasura) {
  debug('🔧 Applying notification SQL schema...');
  await hasura.sql(sqlSchema, 'default', true);
  debug('✅ Notification SQL schema applied.');
  
  debug('🔧 Applying RLS and policies...');
  await hasura.sql(rlsAndPoliciesSQL, 'default', true);
  debug('✅ RLS and policies applied.');
  
  debug('🔧 Granting permissions...');
  await hasura.sql(grantPermissionsSQL, 'default', true);
  debug('✅ Permissions granted.');
}

/**
 * Track notification tables in Hasura
 */
export async function trackTables(hasura: Hasura) {
  debug('🔍 Tracking notification tables...');
  for (const table of tablesToTrack) {
    debug(`  📝 Tracking table ${table.schema}.${table.name}...`);
    await hasura.v1({
      type: 'pg_track_table',
      args: {
        source: 'default',
        schema: table.schema,
        name: table.name
      }
    });
    // Note: hasura.v1 handles 'already tracked' messages internally
  }
  debug('✅ Notification table tracking complete.');
}

/**
 * Create relationships for notification tables
 */
export async function createRelationships(hasura: Hasura) {
  debug('🔗 Creating notification relationships...');
  for (const relationship of relationships) {
     debug(`  📝 Creating relationship ${relationship.args.name} for table ${relationship.args.table.name}...`);
     await hasura.v1(relationship);
     // Note: hasura.v1 handles 'already exists' messages internally
  }
  debug('✅ Notification relationships created.');
}

/**
 * Apply all permissions for notification tables
 */
export async function applyPermissions(hasura: Hasura) {
  debug('🔧 Applying notification permissions...');

  debug('  📝 Applying select permissions...');
  for (const permission of selectPermissions) {
    debug(`     Applying ${permission.args.role} select permission on ${permission.args.table.name}...`);
    await hasura.v1(permission);
    // Note: hasura.v1 handles 'already defined' messages internally
  }
  debug('  ✅ Notification permissions applied.');
}

/**
 * Main migration function for notifications system
 */
export async function up(customHasura?: Hasura) {
  debug('🚀 Starting Hasura Notify migration UP...');
  
  // Use provided hasura instance or create a new one
  const hasura = customHasura || new Hasura({
    url: process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL!, 
    secret: process.env.HASURA_ADMIN_SECRET!,
  });
  
  try {
    await applySQLSchema(hasura);
    await trackTables(hasura);
    await createRelationships(hasura);
    await applyPermissions(hasura);
    debug('✨ Hasura Notify migration UP completed successfully!');
    return true;
  } catch (error) {
    console.error('❗ Critical error during Notify UP migration:', error);
    debug('❌ Notify UP Migration failed.');
    return false;
  }
} 