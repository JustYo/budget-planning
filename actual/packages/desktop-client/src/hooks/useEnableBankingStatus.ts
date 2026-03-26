import { useEffect, useState } from 'react';

import { send } from 'loot-core/platform/client/connection';

import { useSyncServerStatus } from './useSyncServerStatus';

export function useEnableBankingStatus() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const status = useSyncServerStatus();

  useEffect(() => {
    async function fetch() {
      setIsLoading(true);
      const result = await send('enablebanking-status');
      setConfigured(result?.configured ?? false);
      setIsLoading(false);
    }

    if (status === 'online') {
      void fetch();
    }
  }, [status]);

  return { configuredEnableBanking: configured, isLoading };
}
