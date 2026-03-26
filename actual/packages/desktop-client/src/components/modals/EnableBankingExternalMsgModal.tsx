// @ts-strict-ignore
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { AnimatedLoading } from '@actual-app/components/icons/AnimatedLoading';
import { Paragraph } from '@actual-app/components/paragraph';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

import { send } from 'loot-core/platform/client/connection';
import type { SyncServerEnableBankingAccount } from 'loot-core/types/models';

import { Error } from '@desktop-client/components/alerts';
import { Autocomplete } from '@desktop-client/components/autocomplete/Autocomplete';
import { Link } from '@desktop-client/components/common/Link';
import {
  Modal,
  ModalCloseButton,
  ModalHeader,
} from '@desktop-client/components/common/Modal';
import { FormField, FormLabel } from '@desktop-client/components/forms';
import { COUNTRY_OPTIONS } from '@desktop-client/components/util/countries';
import { useEnableBankingStatus } from '@desktop-client/hooks/useEnableBankingStatus';
import { pushModal } from '@desktop-client/modals/modalsSlice';
import type { Modal as ModalType } from '@desktop-client/modals/modalsSlice';
import { useDispatch } from '@desktop-client/redux';

type EnableBankingExternalMsgModalProps = Extract<
  ModalType,
  { name: 'enablebanking-external-msg' }
>['options'];

export function EnableBankingExternalMsgModal({
  onClose,
}: EnableBankingExternalMsgModalProps) {
  const { t } = useTranslation();
  const dispatch = useDispatch();

  const { configuredEnableBanking, isLoading: isConfigurationLoading } =
    useEnableBankingStatus();

  const [aspspCountry, setAspspCountry] = useState<string>('FR');
  const [aspspName, setAspspName] = useState<string>('');
  const [waiting, setWaiting] = useState<null | 'browser' | 'accounts'>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<{
    sessionId: string;
    accounts: SyncServerEnableBankingAccount[];
  } | null>(null);

  const onJump = async () => {
    setError(null);
    setWaiting('browser');

    // post() in loot-core unwraps the server envelope and returns responseData.data
    // directly, so the result is { link, state } not { status, data: { link, state } }.
    const createResult = (await send('enablebanking-create-web-token', {
      aspspName: aspspName || undefined,
      aspspCountry: aspspCountry || undefined,
    })) as
      | { error: string }
      | { error_code: string }
      | { link: string; state: string };

    if (
      'error' in createResult ||
      'error_code' in createResult ||
      !('link' in createResult)
    ) {
      setError(
        t(
          'Failed to start the bank authorisation. Please check your Enable Banking configuration and try again.',
        ),
      );
      setWaiting(null);
      return;
    }

    window.open(createResult.link, '_blank');

    const pollResult = (await send('enablebanking-poll-web-token', {
      state: createResult.state,
    })) as
      | { error: string }
      | {
          data: {
            sessionId: string;
            accounts: SyncServerEnableBankingAccount[];
          };
        };

    if ('error' in pollResult) {
      setError(
        pollResult.error === 'timeout'
          ? t('Timed out waiting for bank authorisation. Please try again.')
          : t(
              'An error occurred while linking your account. Please try again.',
            ),
      );
      setWaiting(null);
      return;
    }

    setSessionData(pollResult.data);
    setWaiting(null);
    setSuccess(true);
  };

  const onContinue = () => {
    if (!sessionData) return;
    dispatch(
      pushModal({
        modal: {
          name: 'select-linked-accounts',
          options: {
            syncSource: 'enableBanking',
            sessionId: sessionData.sessionId,
            externalAccounts: sessionData.accounts,
          },
        },
      }),
    );
  };

  const onEnableBankingInit = () => {
    dispatch(
      pushModal({
        modal: {
          name: 'enablebanking-init',
          options: {
            onSuccess: () => {
              // credentials saved, status hook will refresh
            },
          },
        },
      }),
    );
  };

  const renderLinkButton = () => (
    <View style={{ gap: 10 }}>
      <FormField>
        <FormLabel title={t('Bank country:')} htmlFor="eb-country-field" />
        <Autocomplete
          strict
          highlightFirst
          suggestions={COUNTRY_OPTIONS}
          onSelect={setAspspCountry}
          value={aspspCountry}
          inputProps={{
            id: 'eb-country-field',
            placeholder: t('(please select)'),
          }}
        />
      </FormField>

      <FormField>
        <FormLabel title={t('Bank name (ASPSP):')} htmlFor="eb-bank-field" />
        <input
          id="eb-bank-field"
          value={aspspName}
          onChange={e => setAspspName(e.target.value)}
          placeholder={t('e.g. CIC, Credit Mutuel')}
          style={{
            padding: '6px 8px',
            border: `1px solid ${theme.tableBorder}`,
            borderRadius: 4,
            fontSize: 14,
            color: theme.formInputText,
            backgroundColor: theme.formInputBackground,
          }}
        />
      </FormField>

      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Button
          variant="primary"
          autoFocus
          style={{
            padding: '10px 0',
            fontSize: 15,
            fontWeight: 600,
            flexGrow: 1,
          }}
          onPress={onJump}
          isDisabled={!aspspCountry || !aspspName}
        >
          <Trans>Link bank in browser</Trans> &rarr;
        </Button>
      </View>
    </View>
  );

  return (
    <Modal
      name="enablebanking-external-msg"
      onClose={onClose}
      containerProps={{ style: { width: '30vw' } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Link Your Bank')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View>
            <Paragraph style={{ fontSize: 15 }}>
              <Trans>
                To link your bank account, you will be redirected to Enable
                Banking where they will ask to connect to your bank. Enable
                Banking will not be able to withdraw funds from your accounts.
              </Trans>
            </Paragraph>

            {error && (
              <Error style={{ alignSelf: 'center', marginBottom: 10 }}>
                {error}
              </Error>
            )}

            {waiting || isConfigurationLoading ? (
              <View style={{ alignItems: 'center', marginTop: 15 }}>
                <AnimatedLoading
                  color={theme.pageTextDark}
                  style={{ width: 20, height: 20 }}
                />
                <View style={{ marginTop: 10, color: theme.pageText }}>
                  {isConfigurationLoading
                    ? t('Checking Enable Banking configuration...')
                    : waiting === 'browser'
                      ? t('Waiting on Enable Banking...')
                      : waiting === 'accounts'
                        ? t('Loading accounts...')
                        : null}
                </View>
                {waiting === 'browser' && (
                  <Link
                    variant="text"
                    onClick={onJump}
                    style={{ marginTop: 10 }}
                  >
                    (
                    <Trans>
                      Authorisation page not opening in a new tab? Click here
                    </Trans>
                    )
                  </Link>
                )}
              </View>
            ) : success ? (
              <Button
                variant="primary"
                autoFocus
                style={{
                  padding: '10px 0',
                  fontSize: 15,
                  fontWeight: 600,
                  marginTop: 10,
                }}
                onPress={onContinue}
              >
                <Trans>Success! Click to continue</Trans> &rarr;
              </Button>
            ) : configuredEnableBanking ? (
              renderLinkButton()
            ) : (
              <>
                <Paragraph style={{ color: theme.errorText }}>
                  <Trans>
                    Enable Banking integration has not yet been configured.
                  </Trans>
                </Paragraph>
                <Button variant="primary" onPress={onEnableBankingInit}>
                  <Trans>Configure Enable Banking integration</Trans>
                </Button>
              </>
            )}
          </View>
        </>
      )}
    </Modal>
  );
}
