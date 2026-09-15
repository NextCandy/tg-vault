import { useTranslation } from 'react-i18next';
import { normalizeLocale } from '../../i18n/registry';
import { useBackground } from '../../hooks/useBackground';
import { Palette } from '../ui/icons';
import { SettingsRow } from './SettingsPresentation';
const copy = {
    'zh-CN': { background: '背景主题', simple: '简约', mist: '雾蓝', mode: '明暗模式', light: '浅色', dark: '深色', system: '跟随系统' },
    en: { background: 'Background', simple: 'Simple', mist: 'Blue Mist', mode: 'Appearance', light: 'Light', dark: 'Dark', system: 'System' },
    ru: { background: 'Тема фона', simple: 'Простая', mist: 'Голубая дымка', mode: 'Оформление', light: 'Светлое', dark: 'Тёмное', system: 'Системное' },
};
export function AppearanceSettings() {
    const { i18n } = useTranslation();
    const labels = copy[normalizeLocale(i18n.resolvedLanguage || i18n.language)];
    const { background, setBackground } = useBackground();
    return <>
        <SettingsRow icon={Palette} label={labels.background} action={
            <div className="settings-appearance-options" role="group" aria-label={labels.background}>
                {(['simple', 'mist'] as const).map(value => <button type="button" key={value} aria-pressed={background === value} onClick={() => setBackground(value)}><span className={`settings-theme-swatch settings-theme-swatch--${value}`} aria-hidden="true" />{labels[value]}</button>)}
            </div>
        } />
    </>;
}
