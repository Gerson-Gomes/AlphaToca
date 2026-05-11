#!/usr/bin/env ts-node

/**
 * Verificador de Ambiente para Deploy
 * 
 * Verifica se todas as dependências estão disponíveis antes do deploy
 * 
 * Uso: npx ts-node scripts/verify-environment.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  status: 'ok' | 'fail' | 'warn';
  message: string;
  version?: string;
}

async function checkCommand(command: string, name: string): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync(command, { timeout: 10000 });
    const version = stdout.split('\n')[0].trim();
    return {
      name,
      status: 'ok',
      message: 'Installed',
      version,
    };
  } catch (err) {
    return {
      name,
      status: 'fail',
      message: err instanceof Error ? err.message : 'Not found',
    };
  }
}

async function checkNodeVersion(): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync('node --version');
    const version = stdout.trim();
    const major = parseInt(version.replace('v', '').split('.')[0]);
    
    if (major >= 20) {
      return { name: 'Node.js', status: 'ok', message: 'Version OK', version };
    } else {
      return { name: 'Node.js', status: 'fail', message: `Version ${major} too old, need v20+`, version };
    }
  } catch (err) {
    return { name: 'Node.js', status: 'fail', message: 'Not installed' };
  }
}

async function checkNpmVersion(): Promise<CheckResult> {
  try {
    const { stdout } = await execAsync('npm --version');
    return { name: 'npm', status: 'ok', message: 'Installed', version: stdout.trim() };
  } catch {
    return { name: 'npm', status: 'fail', message: 'Not installed' };
  }
}

async function checkKafkaConnection(): Promise<CheckResult> {
  const brokers = process.env.KAFKA_BROKERS || 'localhost:9092';
  
  try {
    // Tentar conectar ao Kafka via kafkajs
    const kafkaModule = await import('../src/config/kafka');
    const { admin } = kafkaModule;
    
    await admin.connect();
    const topics = await admin.listTopics();
    await admin.disconnect();
    
    return {
      name: 'Kafka',
      status: 'ok',
      message: `Connected, ${topics.length} topics found`,
      version: brokers,
    };
  } catch (err) {
    return {
      name: 'Kafka',
      status: 'fail',
      message: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

async function checkEnvVars(): Promise<CheckResult[]> {
  const required = [
    'DATABASE_URL',
    'KAFKA_BROKERS',
    'WHATSAPP_VERIFY_TOKEN',
    'META_APP_SECRET',
    'TOKEN_ACCES_WHATSAPP',
    'PHONE_NUMBER_ID',
  ];

  const results: CheckResult[] = [];
  let missing = 0;

  for (const varName of required) {
    const value = process.env[varName];
    if (value && value.trim() !== '') {
      results.push({
        name: `ENV: ${varName}`,
        status: 'ok',
        message: 'Set',
      });
    } else {
      results.push({
        name: `ENV: ${varName}`,
        status: 'fail',
        message: 'Not set or empty',
      });
      missing++;
    }
  }

  return results;
}

async function runVerification(): Promise<void> {
  console.log('\n===========================================');
  console.log('       ENVIRONMENT VERIFICATION');
  console.log('===========================================\n');

  const results: CheckResult[] = [];

  console.log('🔍 Checking Node.js...');
  const nodeCheck = await checkNodeVersion();
  results.push(nodeCheck);
  console.log(`   ${nodeCheck.status === 'ok' ? '✅' : '❌'} ${nodeCheck.name}: ${nodeCheck.version || nodeCheck.message}`);

  console.log('\n🔍 Checking npm...');
  const npmCheck = await checkNpmVersion();
  results.push(npmCheck);
  console.log(`   ${npmCheck.status === 'ok' ? '✅' : '❌'} ${npmCheck.name}: ${npmCheck.version || npmCheck.message}`);

  console.log('\n🔍 Checking Kafka...');
  const kafkaCheck = await checkKafkaConnection();
  results.push(kafkaCheck);
  console.log(`   ${kafkaCheck.status === 'ok' ? '✅' : '❌'} ${kafkaCheck.name}: ${kafkaCheck.message}`);

  console.log('\n🔍 Checking Environment Variables...');
  const envChecks = await checkEnvVars();
  results.push(...envChecks);
  for (const check of envChecks) {
    console.log(`   ${check.status === 'ok' ? '✅' : '❌'} ${check.name}`);
  }

  console.log('\n===========================================');
  const failedChecks = results.filter(r => r.status === 'fail');
  if (failedChecks.length > 0) {
    console.log('❌ VERIFICATION FAILED');
    console.log('\nFailed checks:');
    failedChecks.forEach(check => {
      console.log(`   - ${check.name}: ${check.message}`);
    });
    console.log('\nFix the issues above before deploying.');
    process.exit(1);
  } else {
    console.log('✅ ALL CHECKS PASSED');
    console.log('Environment is ready for deployment.');
  }
  console.log('===========================================\n');
}

// Executar se chamado diretamente
if (require.main === module) {
  runVerification().catch((err) => {
    console.error('\n❌ Fatal error during verification:', err);
    process.exit(1);
  });
}

export { runVerification };