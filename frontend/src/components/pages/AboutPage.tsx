import { useTranslation } from 'react-i18next';
import { normalizeLocale } from '../../i18n/registry';
import { ExternalLink } from '../ui/icons';
export const aboutCopy = {
    'zh-CN': { title: '关于', source: '开源地址', community: 'TG 交流反馈群' },
    en: { title: 'About', source: 'Source code', community: 'Telegram community & feedback' },
    ru: { title: 'О проекте', source: 'Исходный код', community: 'Общение и обратная связь в Telegram' },
};
export function AboutPage() {
    const { i18n } = useTranslation();
    const copy = aboutCopy[normalizeLocale(i18n.resolvedLanguage || i18n.language)];
    return <section className="space-y-4 min-w-0">
        <h1 className="text-2xl font-semibold">{copy.title}</h1>
        <div className="tv-panel p-4 sm:p-5 space-y-5">
            {[{ label: copy.source, url: 'https://github.com/hicocos/tg-vault' }, { label: copy.community, url: 'https://t.me/+TBm6l0nI5bpiOGU1' }].map(item => <div key={item.url} className="min-w-0">
                <h2 className="text-sm font-medium">{item.label}</h2>
                <a className="inline-flex min-h-11 max-w-full items-center gap-2 text-sm text-primary underline underline-offset-4" href={item.url} target="_blank" rel="noopener noreferrer"><span className="break-all">{item.url}</span><ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" /></a>
            </div>)}
        </div>
    </section>;
}
