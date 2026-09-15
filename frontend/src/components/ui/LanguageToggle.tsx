import { Languages } from './icons';
import { useTranslation } from 'react-i18next';
import { localeRegistry, normalizeLocale, type AppLocale } from '../../i18n/registry';
import { cn } from '../../lib/utils';

export const LanguageToggle = ({ compact = false, className }: { compact?: boolean; className?: string }) => {
  const { t, i18n } = useTranslation();
  const current = normalizeLocale(i18n.resolvedLanguage || i18n.language);
  return (
    <label className={cn('tv-language inline-flex min-w-0 items-center gap-2 rounded-md border border-input bg-card px-2 text-muted-foreground', compact ? 'min-h-[42px]' : 'min-h-11', className)}>
      <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('common.language.label')}</span>
      <select
        className={cn('min-w-0 !border-0 !bg-transparent !shadow-none py-2 text-sm font-medium text-foreground outline-none', compact && 'max-w-28')}
        aria-label={t('common.language.select')}
        value={current}
        onChange={event => void i18n.changeLanguage(event.target.value as AppLocale)}
      >
        {localeRegistry.map(locale => <option key={locale.code} value={locale.code}>{locale.nativeName}</option>)}
      </select>
    </label>
  );
};
