import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";

/**
 * No connector list: wagmi discovers injected wallets over EIP-6963 on its own, which keeps the
 * bundle clear of the connector barrel and its optional payment dependencies.
 */
export const wagmiConfig = createConfig({
  chains: [sepolia],
  ssr: true,
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  },
});
