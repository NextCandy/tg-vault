import { Check, FileText, Filter, Image as ImageIcon, Music, Video } from "./icons";
import { useTranslation } from "react-i18next";

export type FileTypeCategory = "all" | "image" | "video" | "audio" | "document";

interface FileTypeFilterProps {
    value: string;
    onChange: (category: FileTypeCategory) => void;
}

// The enclosing FilesPage discloses these controls in-flow, not over results.
export const FileTypeFilter = ({ value, onChange }: FileTypeFilterProps) => {
    const { t } = useTranslation();
    const options = [
        { id: "all" as const, label: t("app.fileTypes.all"), icon: Filter },
        { id: "image" as const, label: t("app.fileTypes.images"), icon: ImageIcon },
        { id: "video" as const, label: t("app.fileTypes.videos"), icon: Video },
        { id: "audio" as const, label: t("app.fileTypes.audio"), icon: Music },
        { id: "document" as const, label: t("app.fileTypes.other"), icon: FileText },
    ];
    return (
        <div className="tv-file-type-options" role="group" aria-label={t("app.fileTypes.filter")}>
            {options.map(option => {
                const Icon = option.icon;
                const selected = value === option.id;
                return (
                    <button type="button" key={option.id} aria-pressed={selected} onClick={() => onChange(option.id)}>
                        <Icon aria-hidden="true" />
                        <span className="break-words whitespace-normal">{option.label}</span>
                        {selected && <Check className="tv-file-type-check" aria-hidden="true" />}
                    </button>
                );
            })}
        </div>
    );
};
