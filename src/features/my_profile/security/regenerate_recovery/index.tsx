import { useState } from 'react';
import { Box } from '@mui/material';
import { useAppTranslation } from '@hooks/index';
import { displaySnackNotification } from '@services/states/app';
import { getMessageByCode } from '@services/i18n/translation';
import { apiRegenerateRecoveryCodes } from '@services/api/user';
import Button from '@components/button';
import Dialog from '@components/dialog';
import IconLoading from '@components/icon_loading';
import RecoveryCodes from '@components/recovery_codes';
import Typography from '@components/typography';

type RegenerateRecoveryCodesType = {
  open: boolean;
  onClose: VoidFunction;
};

const RegenerateRecoveryCodes = ({
  open,
  onClose,
}: RegenerateRecoveryCodesType) => {
  const { t } = useAppTranslation();

  const [isProcessing, setIsProcessing] = useState(false);
  const [codes, setCodes] = useState<string[]>(null);

  const handleRegenerate = async () => {
    if (isProcessing) return;

    try {
      setIsProcessing(true);

      const { status, data } = await apiRegenerateRecoveryCodes();

      if (status !== 200) throw new Error(data?.message);

      setCodes(data.recovery_codes);
    } catch (error) {
      displaySnackNotification({
        header: getMessageByCode('error_app_generic-title'),
        message: getMessageByCode(error.message),
        severity: 'error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog onClose={onClose} open={open}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          width: '100%',
        }}
      >
        <Typography className="h2">{t('tr_recoveryCodesTitle')}</Typography>

        {codes ? (
          <>
            <RecoveryCodes codes={codes} />
            <Button variant="main" onClick={onClose}>
              {t('tr_recoveryCodesSavedBtn')}
            </Button>
          </>
        ) : (
          <>
            <Typography className="body-regular" color="var(--grey-400)">
              {t('tr_recoveryCodesRegenerateWarn')}
            </Typography>
            <Box
              sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <Button
                variant="main"
                color="red"
                onClick={handleRegenerate}
                endIcon={
                  isProcessing ? (
                    <IconLoading
                      width={22}
                      height={22}
                      color="var(--black)"
                    />
                  ) : undefined
                }
              >
                {t('tr_recoveryCodesRegenerateConfirm')}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                {t('tr_cancel')}
              </Button>
            </Box>
          </>
        )}
      </Box>
    </Dialog>
  );
};

export default RegenerateRecoveryCodes;
