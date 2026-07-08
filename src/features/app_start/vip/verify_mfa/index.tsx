import { Badge, Box, Stack } from '@mui/material';
import { IconError } from '@components/icons';
import { useAppTranslation } from '@hooks/index';
import useVerifyMFA from './useVerifyMFA';
import Button from '@components/button';
import InfoMessage from '@components/info-message';
import OTPInput from '@components/otp_input';
import PageHeader from '@features/app_start/shared/page_header';
import TextField from '@components/textfield';
import Typography from '@components/typography';

const VerifyMFA = () => {
  const { t } = useAppTranslation();

  const {
    hideMessage,
    message,
    title,
    variant,
    code,
    handleCodeChange,
    hasError,
    handleGoBack,
    tokenDev,
    useRecovery,
    recoveryCode,
    isProcessing,
    handleToggleRecovery,
    handleRecoveryChange,
    handleVerifyRecovery,
  } = useVerifyMFA();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <PageHeader
        title={t('tr_mfaVerifyTitle')}
        description={t('tr_mfaVerifyDesc')}
        onClick={handleGoBack}
      />

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '24px',
        }}
      >
        <Stack spacing="24px">
          {useRecovery ? (
            <>
              <TextField
                label={t('tr_recoveryCodeLabel')}
                value={recoveryCode}
                onChange={(e) => handleRecoveryChange(e.target.value)}
                error={hasError}
                autoComplete="off"
              />
              <Button
                variant="main"
                disabled={isProcessing || recoveryCode.trim().length === 0}
                onClick={handleVerifyRecovery}
              >
                {t('tr_verify')}
              </Button>
            </>
          ) : (
            <>
              <OTPInput
                value={code}
                onChange={handleCodeChange}
                hasError={hasError}
              />

              {tokenDev?.length > 0 && (
                <Box sx={{ display: 'flex', gap: '20px' }}>
                  <Badge badgeContent={'dev'} color="error" />
                  <Box>
                    <Typography>
                      Enter this code to continue: {tokenDev}
                    </Typography>
                  </Box>
                </Box>
              )}
            </>
          )}

          <Typography
            className="body-small-semibold"
            color="var(--accent-main)"
            onClick={handleToggleRecovery}
            sx={{ cursor: 'pointer', alignSelf: 'flex-start' }}
          >
            {useRecovery
              ? t('tr_useAuthenticatorInstead')
              : t('tr_useRecoveryCodeInstead')}
          </Typography>
        </Stack>

        <Box id="onboarding-error" sx={{ display: 'none' }}>
          <InfoMessage
            variant={variant}
            messageIcon={<IconError />}
            messageHeader={title}
            message={message}
            onClose={hideMessage}
          />
        </Box>
      </Box>
    </Box>
  );
};

export default VerifyMFA;
