/**
 * Derive Polymarket CLOB API credentials from your private key.
 *
 * Prerequisites:
 *   npm install @polymarket/clob-client @ethersproject/wallet
 *
 * Usage:
 *   PRIVATE_KEY=0x... node scripts/derive-keys.js
 *
 * IMPORTANT: Run this from the same IP address that will run the trading bot.
 * Polymarket ties API credentials to the requesting IP.
 */

const { ClobClient } = require("@polymarket/clob-client");
const { Wallet } = require("@ethersproject/wallet");

async function deriveKeys() {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error("Error: PRIVATE_KEY environment variable is not set.");
        console.error("Usage: PRIVATE_KEY=0x... node scripts/derive-keys.js");
        process.exit(1);
    }

    const wallet = new Wallet(privateKey);
    console.log("Wallet address:", wallet.address);

    const client = new ClobClient(
        "https://clob.polymarket.com",
        137, // Polygon chainId
        wallet
    );

    try {
        console.log("Creating or deriving CLOB API credentials...");
        const creds = await client.createOrDeriveApiKey();

        console.log("");
        console.log("=== Add these to your .env file ===");
        console.log(`CLOB_API_KEY=${creds.key}`);
        console.log(`CLOB_API_SECRET=${creds.secret}`);
        console.log(`CLOB_PASSPHRASE=${creds.passphrase}`);
        console.log("===================================");
    } catch (error) {
        console.error("Failed to derive keys:", error.message);
        process.exit(1);
    }
}

deriveKeys();
