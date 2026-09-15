import ru from '../ru.json';
import { redesign } from './redesign';
import { uiAudit } from './uiAudit';
import { botConnection } from './botConnection';
import { mergeCatalogs } from '../../i18n/mergeCatalogs';
export default mergeCatalogs(ru, redesign, uiAudit, botConnection);
