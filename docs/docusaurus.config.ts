import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Templarc Documentation',
  tagline: 'A general-purpose template engine API for any provisioning or text-generation task',
  favicon: 'img/favicon.ico',

  url: process.env.DOCS_URL || 'http://localhost',
  baseUrl: process.env.DOCS_BASE_URL ?? '/docs/',

  onBrokenLinks: 'ignore',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl: undefined,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    // Search is only active in the production build — the plugin interferes
    // with webpack HMR in dev mode and there is no index to search anyway.
    ...(!(process.env.DOCS_BASE_URL)
      ? [
          [
            '@easyops-cn/docusaurus-search-local',
            {
              hashed: true,
              docsRouteBasePath: '/',
              indexBlog: false,
              highlightSearchTermsOnTargetPage: true,
            },
          ] as [string, object],
        ]
      : []),
  ],

  themeConfig: {
    image: 'img/templarc-social.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Templarc',
      logo: {
        alt: 'Templarc Logo',
        src: 'img/logo.svg',
        srcDark: 'img/logo.svg',
      },
      items: [
        {
          label: 'Tutorials',
          to: '/',
          position: 'left',
        },
        {
          label: 'User Guide',
          to: '/user-guide/intro',
          position: 'left',
        },
        {
          label: 'Admin Guide',
          to: '/admin-guide/intro',
          position: 'left',
        },
        {
          label: 'Developer Guide',
          to: '/developer-guide/intro',
          position: 'left',
        },
        {
          label: 'API Reference',
          to: '/api-reference/',
          position: 'left',
        },
        {
          label: '← Back to App',
          href: '/',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [],
      copyright: `Templarc — Template Engine API`,
    },
    prism: {
      theme: prismThemes.oneDark,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'yaml', 'nginx', 'python', 'json', 'docker'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
