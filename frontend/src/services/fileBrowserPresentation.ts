const copy = {
    'zh-CN': {
        details: '详情', file: '文件', noExtension: '无后缀文件',
        directory: '当前目录（不含子目录内容）', results: '当前筛选结果', favoritesScope: '当前目录的收藏',
        favorites: '这里还没有收藏', favoritesHint: '在文件或文件夹的更多操作中选择“收藏”，即可在这里找到它们。', browse: '浏览当前目录',
        sort: '排序', nameAsc: '名称：升序', nameDesc: '名称：降序', dateAsc: '日期：最早优先', dateDesc: '日期：最新优先',
        sortName: '按名称排序', sortDate: '按日期排序',
    },
    en: {
        details: 'Details', file: 'File', noExtension: 'No file extension',
        directory: 'Current folder (excluding subfolder contents)', results: 'Filtered results', favoritesScope: 'Favorites in this folder',
        favorites: 'No favorites here yet', favoritesHint: 'Choose “Favorite” from a file or folder’s actions menu to find it here.', browse: 'Browse this folder',
        sort: 'Sort', nameAsc: 'Name: ascending', nameDesc: 'Name: descending', dateAsc: 'Date: oldest first', dateDesc: 'Date: newest first',
        sortName: 'Sort by name', sortDate: 'Sort by date',
    },
    ru: {
        details: 'Подробнее', file: 'Файл', noExtension: 'Без расширения',
        directory: 'Текущая папка (без содержимого вложенных папок)', results: 'Результаты фильтрации', favoritesScope: 'Избранное в этой папке',
        favorites: 'Здесь пока нет избранного', favoritesHint: 'Выберите «В избранное» в меню действий файла или папки, чтобы они появились здесь.', browse: 'Открыть текущую папку',
        sort: 'Сортировка', nameAsc: 'Имя: по возрастанию', nameDesc: 'Имя: по убыванию', dateAsc: 'Дата: сначала старые', dateDesc: 'Дата: сначала новые',
        sortName: 'По имени', sortDate: 'По дате',
    },
};

export function fileBrowserCopy(language: string) {
    return copy[language.startsWith('zh') ? 'zh-CN' : language.startsWith('ru') ? 'ru' : 'en'];
}

// Do not invent a format for extensionless files or dotfiles, or truncate the identifier.
export function fileExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : '';
}
