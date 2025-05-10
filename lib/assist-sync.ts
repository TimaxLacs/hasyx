import readline from 'readline';
import Debug from './debug';
import { createRlInterface, askYesNo, parseEnvFile, getGitHubRemoteUrl, writeEnvFile, askForInput } from './assist-common';
import { getVercelProjectName } from './assist-vercel';
import path from 'path';
import spawn from 'cross-spawn';
import { SpawnSyncOptions } from 'child_process';
import fs from 'fs-extra';

const debug = Debug('assist:sync');

export async function syncEnvironmentVariables(rl: readline.Interface, envPath: string, options: { skipVercel?: boolean, skipGithub?: boolean } = {}): Promise<void> {
  debug('Syncing environment variables'); console.log('🔄 Syncing environment variables...');
  const envVars = parseEnvFile(envPath);

  const vercelToken = envVars.VERCEL_TOKEN;
  const vercelOrgId = envVars.VERCEL_TEAM_ID;
  let vercelProjectNameForLink = envVars.VERCEL_PROJECT_NAME;

  if (!options.skipVercel) {
    if (await askYesNo(rl, 'Do you want to sync .env with Vercel?', true)) {
      if (!vercelToken) {
        console.log('⚠️ VERCEL_TOKEN not found in .env. Skipping Vercel sync.');
      } else {
        let isLinkedSuccessfully = false;

        if (!vercelProjectNameForLink) {
          vercelProjectNameForLink = await askForInput(rl, 'Enter Vercel Project Name to link with (e.g., my-vercel-project). Leave blank to attempt using an existing link or skip Vercel setup:');
        }

        if (vercelProjectNameForLink) {
          console.log(`\n🔗 Ensuring your local directory is linked to Vercel project "${vercelProjectNameForLink}".`);
          console.log("   You might be prompted by Vercel CLI to confirm the project and scope (team/organization).");

          const linkCommandParts = ['npx', 'vercel', 'link', vercelProjectNameForLink, `--token=${vercelToken}`];
          if (vercelOrgId) {
            linkCommandParts.push(`--scope=${vercelOrgId}`);
          }

          debug(`Executing: ${linkCommandParts.join(' ')}`);
          const linkResult = spawn.sync(linkCommandParts[0], linkCommandParts.slice(1), { stdio: 'inherit' });

          if (linkResult.status === 0) {
            console.log(`✅ Successfully linked to Vercel project: ${vercelProjectNameForLink}.`);
            isLinkedSuccessfully = true;
            if (envVars.VERCEL_PROJECT_NAME !== vercelProjectNameForLink) {
              envVars.VERCEL_PROJECT_NAME = vercelProjectNameForLink;
            }
          } else {
            console.error(`❌ Failed to link to Vercel project "${vercelProjectNameForLink}". Vercel environment sync will be skipped.`);
          }
        } else {
          const vercelJsonPath = path.join(process.cwd(), '.vercel', 'project.json');
          if (fs.existsSync(vercelJsonPath)) {
            try {
              const projectJson = fs.readJsonSync(vercelJsonPath);
              if (projectJson.projectId && projectJson.orgId) {
                console.log(`✅ Using existing Vercel link (Project ID: ${projectJson.projectId}, Org ID: ${projectJson.orgId}). Vercel project name for display is taken from .env if present.`);
                isLinkedSuccessfully = true;
              }
            } catch (e) {
              debug('Error reading .vercel/project.json, assuming not reliably linked:', e);
            }
          }
          if (!isLinkedSuccessfully) {
            console.log('No Vercel project name specified for linking and not already linked. Skipping Vercel sync.');
          }
        }

        if (isLinkedSuccessfully) {
          console.log(`\n🔄 Now syncing environment variables with the linked Vercel project...`);
          const tokenArgsForEnv = [`--token=${vercelToken}`];

          const pullArgs = ['env', 'pull', '.env.vercel', '--yes', ...tokenArgsForEnv];
          debug(`Executing: npx vercel ${pullArgs.join(' ')}`);
          const pullResult = spawn.sync('npx', ['vercel', ...pullArgs], { stdio: 'inherit' });

          if (pullResult.status !== 0) {
            console.error('❌ Failed to pull Vercel environment variables.');
          } else {
            console.log('✅ Pulled Vercel environment. Merging and pushing local settings...');
            const vercelEnvPulled = parseEnvFile('.env.vercel');
            
            const desiredVercelState = { ...envVars };
            desiredVercelState.NEXT_PUBLIC_WS = '0';

            let changesPushed = false;
            for (const [key, value] of Object.entries(desiredVercelState)) {
              if (vercelEnvPulled[key] !== value || !Object.prototype.hasOwnProperty.call(vercelEnvPulled, key)) {
                changesPushed = true;
                for (const envType of ['production', 'preview', 'development']) {
                  const addArgs = ['env', 'add', key, value as string, envType, '--yes', ...tokenArgsForEnv];
                  debug(`Executing: npx vercel ${addArgs.join(' ')}`);
                  const addResult = spawn.sync('npx', ['vercel', ...addArgs], { stdio: 'pipe', encoding: 'utf-8' });
                  if (addResult.status !== 0) {
                    console.error(`❌ Failed to add/update ${key} in Vercel ${envType} env. Error: ${addResult.stderr || addResult.error}`);
                  } else {
                    console.log(`✅ Added/Updated ${key} in Vercel ${envType} env.`);
                  }
                }
              }
            }
            if (changesPushed) {
                console.log("✅ Relevant changes from local .env (and NEXT_PUBLIC_WS=0) pushed to Vercel.")
            } else {
                console.log("ℹ️ No differing variables (or only NEXT_PUBLIC_WS was already 0) needed to be pushed to Vercel.")
            }

            writeEnvFile(envPath, envVars);
            console.log(`✅ Local ${envPath} has been updated/saved.`);
            console.log('✅ Vercel environment sync complete.');
            fs.removeSync('.env.vercel');
          }
        } else if (envVars.VERCEL_PROJECT_NAME && !isLinkedSuccessfully) {
            debug(`Skipping Vercel env sync because linking to ${envVars.VERCEL_PROJECT_NAME} failed earlier.`);
        }
      }
    }
  }

  if (!options.skipGithub) {
    if (await askYesNo(rl, 'Do you want to sync .env with GitHub Actions secrets?', true)) {
      const remoteUrl = getGitHubRemoteUrl();
      if (!remoteUrl) { console.log('⚠️ GitHub remote URL not found. Skipping GitHub secrets sync.'); }
      else {
        console.log(`Syncing .env with GitHub Actions secrets for repository: ${remoteUrl}`);
        const baseEnvForGithub = parseEnvFile(envPath);
        const excludedKeys = (baseEnvForGithub.GITHUB_SECRETS_EXCLUDE || '').split(',').map(k => k.trim()).filter(Boolean);
        excludedKeys.push('GITHUB_TOKEN', 'VERCEL_TOKEN', 'NPM_TOKEN');
        excludedKeys.push('VERCEL_TEAM_ID', 'VERCEL_PROJECT_NAME', 'GITHUB_SECRETS_EXCLUDE');
        
        for (const [key, value] of Object.entries(baseEnvForGithub)) {
          if (excludedKeys.includes(key) || typeof value !== 'string') {
            debug(`Skipping ${key} from GitHub secrets sync (excluded or not a string).`);
            continue;
          }
          const secretSetResult = spawn.sync('gh', ['secret', 'set', key, '--body', value, '-R', remoteUrl], { stdio: 'pipe', encoding: 'utf-8' });
          if (secretSetResult.status !== 0) { console.error(`❌ Failed to set GitHub secret: ${key}`); debug(secretSetResult.stderr?.toString());}
          else { console.log(`✅ Set GitHub secret: ${key}`); }
        }
        console.log('✅ GitHub Actions secrets sync complete.');
      }
    }
  }
}

async function main() {
  const rl = createRlInterface();
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found. Please create or configure it first.');
    rl.close();
    process.exit(1);
  }
  try {
    await syncEnvironmentVariables(rl, envPath);
    console.log('✅ Environment variable synchronization process finished.');
  } catch (error) {
    console.error('❌ Error during environment variable synchronization process:', error);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
} 