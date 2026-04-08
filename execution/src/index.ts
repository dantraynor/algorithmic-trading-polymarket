/**
 * Execution Engine - Entry Point
 */

import { loadConfig } from './config';
import { ExecutionEngine } from './execution-engine';
import { logger } from './logger';

async function main() {
  logger.info('Initializing Polymarket Execution Engine v1.0.0');

  try {
    // Load configuration
    const config = await loadConfig();
    
    // Validate required config
    if (!config.privateKey) {
      throw new Error('Private key not configured');
    }
    
    if (!config.clobApiKey || !config.clobApiSecret) {
      throw new Error('CLOB API credentials not configured');
    }

    // Create and start engine
    const engine = new ExecutionEngine(config);
    
    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down...');
      await engine.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down...');
      await engine.stop();
      process.exit(0);
    });

    // Start the engine
    await engine.start();
    
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
