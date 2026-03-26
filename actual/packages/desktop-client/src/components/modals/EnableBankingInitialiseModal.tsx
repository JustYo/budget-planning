// @ts-strict-ignore
import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { ButtonWithLoading } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';

import { send } from 'loot-core/platform/client/connection';
import { getSecretsError } from 'loot-core/shared/errors';

import { Error } from '@desktop-client/components/alerts';
import { Link } from '@desktop-client/components/common/Link';
import {
  Modal,
  ModalButtons,
  ModalCloseButton,
  ModalHeader,
} from '@desktop-client/components/common/Modal';
import { FormField, FormLabel } from '@desktop-client/components/forms';
import type { Modal as ModalType } from '@desktop-client/modals/modalsSlice';

type EnableBankingInitialiseModalProps = Extract<
  ModalType,
  { name: 'enablebanking-init' }
>['options'];

export const EnableBankingInitialiseModal = ({
  onSuccess,
}: EnableBankingInitialiseModalProps) => {
  const { t } = useTranslation();
  const [applicationId, setApplicationId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [isValid, setIsValid] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (close: () => void) => {
    if (!applicationId || !privateKey) {
      setIsValid(false);
      setError(t('Application ID and private key are required.'));
      return;
    }

    setIsLoading(true);

    const idResult = await send('secret-set', {
      name: 'enablebanking_applicationId',
      value: applicationId,
    });

    if (idResult?.error) {
      setIsValid(false);
      setError(getSecretsError(idResult.error, idResult.reason));
      setIsLoading(false);
      return;
    }

    const keyResult = await send('secret-set', {
      name: 'enablebanking_privateKey',
      value: privateKey,
    });

    if (keyResult?.error) {
      setIsValid(false);
      setError(getSecretsError(keyResult.error, keyResult.reason));
      setIsLoading(false);
      return;
    }

    onSuccess();
    setIsLoading(false);
    close();
  };

  return (
    <Modal name="enablebanking-init" containerProps={{ style: { width: 500 } }}>
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Set-up Enable Banking')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ display: 'flex', gap: 10 }}>
            <Text>
              <Trans>
                Enable Banking provides bank sync for European banks (CIC,
                Crédit Mutuel, and more). You need an{' '}
                <Link
                  variant="external"
                  to="https://enablebanking.com"
                  linkColor="purple"
                >
                  Enable Banking
                </Link>{' '}
                developer account with an application ID and RS256 private key.
              </Trans>
            </Text>

            <FormField>
              <FormLabel
                title={t('Application ID:')}
                htmlFor="eb-application-id"
              />
              <Input
                id="eb-application-id"
                value={applicationId}
                onChangeValue={value => {
                  setApplicationId(value);
                  setIsValid(true);
                }}
              />
            </FormField>

            <FormField>
              <FormLabel
                title={t('RS256 Private Key (PEM):')}
                htmlFor="eb-private-key"
              />
              <textarea
                id="eb-private-key"
                value={privateKey}
                rows={8}
                placeholder="-----BEGIN RSA PRIVATE KEY-----"
                onChange={e => {
                  setPrivateKey(e.target.value);
                  setIsValid(true);
                }}
                style={{
                  ...styles.smallText,
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                }}
              />
            </FormField>

            {!isValid && <Error>{error}</Error>}
          </View>

          <ModalButtons>
            <ButtonWithLoading
              variant="primary"
              autoFocus
              isLoading={isLoading}
              onPress={() => {
                void onSubmit(() => state.close());
              }}
            >
              <Trans>Save and continue</Trans>
            </ButtonWithLoading>
          </ModalButtons>
        </>
      )}
    </Modal>
  );
};
