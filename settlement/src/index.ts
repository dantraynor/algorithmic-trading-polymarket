/**
 * Settlement Service - Entry Point
 */

import { loadConfig } from './config';
import { MergeService } from './merge-service';
import { logger } from './logger';

async function main() {
  logger.info('Initializing Polymarket Settlement Service v1.0.0');

  try {
    // Load configuration
    const config = loadConfig();
    
    // Validate required config
    if (!config.privateKey) {
      throw new Error('Private key not configured');
    }
    
    if (!config.gnosisSafeAddress) {
      throw new Error('Gnosis Safe address not configured');
    }

    // Create and start service
    const service = new MergeService(config);
    
    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down...');
      await service.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down...');
      await service.stop();
      process.exit(0);
    });

    // Log initial balance
    const balance = await service.getSafeBalance();
    logger.info(`Safe USDCe balance: ${Number(balance) / 1e6}`);

    // Start the service
    await service.start();
    
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
