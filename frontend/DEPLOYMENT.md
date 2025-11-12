# Deploying to Vercel

## Quick Deploy (Using Existing deployments.json)

The frontend will work on Vercel as-is if you commit `deployments.json` to your repo. Vercel will serve it as a static file. However, this is not recommended for production because:
- Hard to manage different environments (dev/staging/prod)
- Contract addresses are committed to git
- Need to rebuild/redeploy when addresses change

## Recommended: Using Environment Variables

This approach allows you to:
- Set different addresses for different environments
- Keep sensitive RPC URLs out of git
- Update addresses without code changes

### 1. Set Environment Variables in Vercel

Go to your Vercel project settings → Environment Variables and add:

```
VITE_CHAIN_ID=11155111
VITE_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
VITE_DEGEN_RPS_ADDRESS=0xfa214576764c87d21acb8988b07cb53f732a541b
VITE_TOKEN0_ADDRESS=0xf0711ae8902822c8fa99f93e4d6db436d065c609
VITE_TOKEN1_ADDRESS=0x83696c189589910d08640cf1c285e3b15eceefb7
```

### 2. Deploy

The build process will automatically:
- Generate `deployments.json` from environment variables
- Preserve ABIs from existing deployments.json
- Build the frontend with the correct addresses

### 3. Local Development

For local development, you can either:
- Keep using `deployments.json` directly (no env vars needed)
- Create `.env.local` with the same variables (see `.env.example`)

## Important Notes

- **ABIs**: Contract ABIs are preserved from `deployments.json`. Only addresses are overridden by env vars.
- **Public Variables**: All `VITE_*` variables are exposed to the client-side code (this is expected for contract addresses).
- **RPC URL**: Make sure your Infura key is set correctly. Consider using Vercel's environment variable encryption for sensitive keys.

## Alternative: Multiple Environments

You can set different environment variables for:
- **Production**: Mainnet or production testnet addresses
- **Preview**: Staging/test addresses
- **Development**: Localhost addresses

Vercel will automatically use the correct variables based on the deployment environment.
