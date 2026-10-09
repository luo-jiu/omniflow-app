import React from 'react';
import CreateNodeModal from '@/features/file-explorer/components/directory-tree/modals/CreateNodeModal';
import type {
  CreateFileOverlayProps,
  CreateFileResult,
  OverlayStorageProvider,
} from '@/service/overlay/types';
import type { OverlayComponentProps } from '../registry';

function selectPreferredProvider(providers: OverlayStorageProvider[], defaultProvider: string): string {
  const availableProviders = providers.filter(provider => provider.alias.trim());
  const normalizedDefault = defaultProvider.trim().toLowerCase();
  const defaultItem = availableProviders.find(provider => provider.alias.trim().toLowerCase() === normalizedDefault);
  const healthy = availableProviders.filter(provider => provider.healthStatus === 'ok');
  const healthyDefault = healthy.find(provider => provider === defaultItem);
  return healthyDefault?.alias
    || healthy[0]?.alias
    || defaultItem?.alias
    || availableProviders.find(provider => !provider.healthStatus || provider.healthStatus === 'unknown')?.alias
    || availableProviders[0]?.alias
    || '';
}

export const CreateFileOverlayAdapter: React.FC<
  OverlayComponentProps<CreateFileOverlayProps, CreateFileResult>
> = ({ props, onResolve, onCancel }) => {
  const [name, setName] = React.useState(props.initialName);
  const [selectedProvider, setSelectedProvider] = React.useState(() => (
    props.initialStorageProvider || selectPreferredProvider(props.providers, props.defaultProvider)
  ));
  // A retry carries the previous selection, including a provider that just failed.
  const providerSelectionWasManualRef = React.useRef(Boolean(props.initialStorageProvider));
  const settledRef = React.useRef(false);

  React.useEffect(() => {
    if (providerSelectionWasManualRef.current) {
      return;
    }
    if (props.providers.find(provider => provider.alias === selectedProvider)?.healthStatus === 'ok') {
      return;
    }
    setSelectedProvider(selectPreferredProvider(props.providers, props.defaultProvider));
  }, [props.defaultProvider, props.providers, selectedProvider]);

  const handleConfirm = () => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    onResolve({ type: 'confirm', name, storageProvider: selectedProvider });
  };

  const handleCancel = () => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    onCancel();
  };

  return (
    <CreateNodeModal
      visible
      loading={false}
      name={name}
      defaultProvider={props.defaultProvider}
      providers={props.providers}
      providerLoading={props.providerLoading}
      selectedProvider={selectedProvider}
      errorMessage={props.errorMessage}
      onNameChange={setName}
      onProviderChange={(value) => {
        providerSelectionWasManualRef.current = true;
        setSelectedProvider(value);
      }}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
};
