"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZamaProvider } from "@zama-fhe/react-sdk";
import { createConfig as createZamaConfig } from "@zama-fhe/react-sdk/wagmi";
import { sepolia as sepoliaFhe } from "@zama-fhe/sdk/chains";
import { web } from "@zama-fhe/sdk/web";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "~/lib/wagmi";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// The SDK derives its signer and provider from the wagmi config, so there is one wallet connection
// rather than two that can drift apart.
const zamaConfig = createZamaConfig({
  chains: [sepoliaFhe],
  wagmiConfig,
  relayers: { [sepoliaFhe.id]: web() },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ZamaProvider config={zamaConfig}>{children}</ZamaProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
