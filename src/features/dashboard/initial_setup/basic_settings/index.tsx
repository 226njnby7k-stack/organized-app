import { Box, Stack } from '@mui/material';
import { useAppTranslation } from '@hooks/index';
import { IS_SELF_HOSTED } from '@constants/index';
import { BasicSettingsProps } from './index.types';
import useBasicSettings from './useBasicSettings';
import Button from '@components/button';
import CongregationBasic from '@features/congregation/settings/congregation_basic';
import DateFormat from '@features/congregation/settings/meeting_forms/date_format';
import DataSharing from '@features/congregation/settings/congregation_privacy/data_sharing';
import HourFormat from '@features/congregation/settings/congregation_basic/hour_format';
import NameFormat from '@features/congregation/settings/meeting_forms/name_format';
import Typography from '@components/typography';

const BasicSettings = (props: BasicSettingsProps) => {
  const { t } = useAppTranslation();

  const { handleSave } = useBasicSettings(props);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Typography color="var(--grey-400)">
        {t(
          IS_SELF_HOSTED
            ? 'tr_selfHostedCongregationSetupDesc'
            : 'tr_initialOrganizedSetupDescStep_1'
        )}
      </Typography>

      <DataSharing />

      {/* Self-hosted congregations are created with blank number/address/circuit
          and neutral meeting defaults (no external directory to fill them), so
          surface the full congregation-basic editor here for the admin to
          complete right after creation. CongregationBasic already includes the
          hour-format control, so the standalone one is only shown otherwise. */}
      {IS_SELF_HOSTED ? <CongregationBasic /> : <HourFormat />}

      <Stack spacing="24px" marginTop="12px">
        <DateFormat />

        <NameFormat />
      </Stack>

      <Stack spacing="8px">
        <Button variant="main" onClick={handleSave}>
          {t('tr_saveAndContinueBtn')}
        </Button>
        <Button variant="secondary" onClick={props.onMove}>
          {t('tr_skipThisStepBtn')}
        </Button>
      </Stack>
    </Box>
  );
};

export default BasicSettings;
