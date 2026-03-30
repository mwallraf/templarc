import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    {
      type: 'category',
      label: 'Tutorials',
      collapsed: false,
      link: { type: 'doc', id: 'tutorials/index' },
      items: [
        'tutorials/getting-started',
        'tutorials/render-a-template',
        'tutorials/create-a-template',
        'tutorials/history-and-reuse',
      ],
    },
    {
      type: 'category',
      label: 'User Guide',
      collapsed: false,
      items: [
        'user-guide/intro',
        'user-guide/browsing-catalog',
        'user-guide/filling-forms',
        'user-guide/rendering',
        'user-guide/render-history',
        'user-guide/presets',
        'user-guide/features',
      ],
    },
    {
      type: 'category',
      label: 'Admin Guide',
      collapsed: true,
      items: [
        'admin-guide/intro',
        'admin-guide/installation',
        'admin-guide/first-time-setup',
        'admin-guide/organizations',
        'admin-guide/users-and-roles',
        'admin-guide/projects',
        'admin-guide/secrets',
        'admin-guide/custom-filters',
        'admin-guide/custom-objects',
        'admin-guide/macros',
        'admin-guide/api-keys',
        'admin-guide/git-remote',
        'admin-guide/audit-log',
        'admin-guide/ldap',
      ],
    },
    {
      type: 'category',
      label: 'Developer Guide',
      collapsed: true,
      items: [
        'developer-guide/intro',
        'developer-guide/architecture',
        'developer-guide/dev-setup',
        'developer-guide/writing-templates',
        'developer-guide/parameter-scoping',
        'developer-guide/data-sources',
        'developer-guide/jinja2-filters',
        'developer-guide/api-integration',
        'developer-guide/contributing',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      collapsed: true,
      items: ['api-reference/index'],
    },
  ],
};

export default sidebars;
