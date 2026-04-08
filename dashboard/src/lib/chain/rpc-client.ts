import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';

export const polygonClient = createPublicClient({
  chain: polygon,
  transport: http(process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com'),
});
