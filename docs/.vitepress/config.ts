import { defineConfig } from "vitepress";

export default defineConfig({
  title: "better-auth-tenancy",
  description: "Multi-tenant authentication plugin for Better Auth",
  base: "/",
  head: [["link", { rel: "icon", href: "/favicon.svg" }]],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/endpoints" },
      { text: "Example", link: "/examples/nextjs" },
      {
        text: "GitHub",
        link: "https://github.com/kourosh-alasti/better-auth-tenancy",
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Installation", link: "/guide/installation" },
          ],
        },
        {
          text: "Guides",
          items: [
            { text: "Configuration", link: "/guide/configuration" },
            { text: "Tenant management", link: "/guide/tenant-management" },
            { text: "Email auth", link: "/guide/email-auth" },
            { text: "OAuth", link: "/guide/oauth" },
          ],
        },
      ],
      "/api/": [
        {
          text: "Reference",
          items: [
            { text: "Endpoints", link: "/api/endpoints" },
            { text: "Schema", link: "/api/schema" },
            { text: "Error codes", link: "/api/error-codes" },
            { text: "Client plugin", link: "/api/client" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [{ text: "Next.js demo", link: "/examples/nextjs" }],
        },
      ],
    },
    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/kourosh-alasti/better-auth-tenancy",
      },
    ],
    search: {
      provider: "local",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © The Alasti Company",
    },
  },
});
