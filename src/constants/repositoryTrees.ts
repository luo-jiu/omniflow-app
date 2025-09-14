// 仓库树静态数据
export const repositoryTrees = {
  LB_01: [
    {
      label: 'C盘',
      key: 'drive-c',
      children: [
        { label: 'Users', key: 'c-users-folder', children: [] },
        { label: 'Program Files', key: 'c-program-files', children: [] },
        { label: 'config.txt', key: 'c-config-file' },
        { label: 'Windows', key: 'c-windows', children: [] }
      ]
    },
    {
      label: 'D盘',
      key: 'drive-d',
      children: [
        { label: 'Projects', key: 'd-projects-folder', children: [] },
        { label: 'Documents', key: 'd-documents', children: [] },
        { label: 'readme.md', key: 'd-readme-file' },
        { label: 'Users', key: 'd-users-folder', children: [] }
      ]
    }
  ],
  Library_01: [
    {
      label: 'src',
      key: 'src-folder',
      children: [
        { label: 'components', key: 'components-folder', children: [] },
        { label: 'pages', key: 'pages-folder', children: [] },
        { label: 'main.tsx', key: 'main-file' },
        { label: 'App.tsx', key: 'app-file' }
      ]
    },
    {
      label: 'public',
      key: 'public-folder',
      children: [
        { label: 'index.html', key: 'index-file' },
        { label: 'favicon.ico', key: 'favicon-file' }
      ]
    },
    { label: 'package.json', key: 'package-file' }
  ],
  Library_xxx: [
    {
      label: 'backend',
      key: 'backend-folder',
      children: [
        { label: 'controllers', key: 'controllers-folder', children: [] },
        { label: 'models', key: 'models-folder', children: [] },
        { label: 'config.js', key: 'config-file' },
        { label: 'server.js', key: 'server-file' }
      ]
    },
    {
      label: 'database',
      key: 'database-folder',
      children: [
        { label: 'migrations', key: 'migrations-folder', children: [] },
        { label: 'schema.sql', key: 'schema-file' }
      ]
    },
    { label: 'README.md', key: 'readme-file' }
  ]
};
