import { LayoutGrid, List as ListIcon } from "./icons";
import { useTranslation } from "react-i18next";

interface ViewToggleProps {
    viewMode: "grid" | "list";
    setViewMode: (mode: "grid" | "list") => void;
}

export const ViewToggle = ({ viewMode, setViewMode }: ViewToggleProps) => {
    const { t } = useTranslation();
    return (
        <div className="tv-view-toggle" role="group">
            <button type="button" onClick={() => setViewMode("grid")} aria-pressed={viewMode === 'grid'} aria-label={t('files.gridView')} title={t('files.gridView')}>
                <LayoutGrid aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setViewMode("list")} aria-pressed={viewMode === 'list'} aria-label={t('files.listView')} title={t('files.listView')}>
                <ListIcon aria-hidden="true" />
            </button>
        </div>
    );
};
