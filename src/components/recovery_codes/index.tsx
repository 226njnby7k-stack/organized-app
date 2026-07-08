import { Box } from '@mui/material';
import { useAppTranslation } from '@hooks/index';
import { displaySnackNotification } from '@services/states/app';
import { IconCopy } from '@components/icons';
import Button from '@components/button';
import Typography from '@components/typography';

/**
 * Shows a set of MFA recovery codes with copy + download affordances. These are
 * returned by the API exactly once (at enrollment / regeneration), so this is the
 * user's single opportunity to save them — the wording makes that explicit.
 */
const RecoveryCodes = ({ codes }: { codes: string[] }) => {
  const { t } = useAppTranslation();

  const asText = codes.join('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(asText);
    displaySnackNotification({
      header: t('tr_recoveryCodesCopied'),
      message: t('tr_recoveryCodesCopiedDesc'),
      severity: 'success',
    });
  };

  const handleDownload = () => {
    const blob = new Blob([asText + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'organized-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}
    >
      <Typography className="body-regular" color="var(--grey-400)">
        {t('tr_recoveryCodesSaveDesc')}
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px 16px',
          padding: '16px',
          border: '1px solid var(--accent-200)',
          borderRadius: '8px',
          backgroundColor: 'var(--accent-100)',
        }}
      >
        {codes.map((code) => (
          <Typography
            key={code}
            className="body-regular"
            sx={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}
          >
            {code}
          </Typography>
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          onClick={handleCopy}
          startIcon={<IconCopy color="var(--accent-400)" />}
          disableAutoStretch
        >
          {t('tr_recoveryCodesCopy')}
        </Button>
        <Button variant="secondary" onClick={handleDownload} disableAutoStretch>
          {t('tr_recoveryCodesDownload')}
        </Button>
      </Box>
    </Box>
  );
};

export default RecoveryCodes;
