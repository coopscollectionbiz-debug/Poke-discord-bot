// ==========================================================
// 🛡️ /admindashboard — open the admin analytics dashboard
// ==========================================================
//
// WHO CAN USE THIS?
// -----------------
// Only Discord users who hold the role named by ADMIN_ROLE_NAME
// (defaults to "Developer"). Gating on role name means the server
// owner can grant/revoke access just by toggling the role — no
// code changes or env var updates needed when the team changes.
//
// HOW IT WORKS
// ------------
// 1. Invoking user's roles are checked against ADMIN_ROLE_NAME.
// 2. If they have it, we mint an admin-typed session token via
//    generateToken(userId, channelId, "admin").
// 3. They get an ephemeral reply with a short-lived link to
//    /auth/admin, which sets the admin_session cookie and
//    redirects to /public/admindashboard.
//
// WHY EPHEMERAL?
// --------------
// The link is single-user and 10 minutes. Exposing it in a public
// channel would be mostly harmless (token is user-bound) but
// ephemeral keeps things tidy.
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { generateToken } from "../bot_final.js";

const ADMIN_ROLE_NAME = process.env.ADMIN_ROLE_NAME || "Developer";

export default {
  data: new SlashCommandBuilder()
    .setName("admindashboard")
    .setDescription("Open the admin analytics dashboard (Developer role required)."),

  async execute(interaction) {
    try {
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      // Role check. We look up by name rather than ID so admins
      // can rename the role or move it between servers without
      // requiring an env var update.
      const member = interaction.member;
      const hasRole = member?.roles?.cache?.some(
        (r) => r.name === ADMIN_ROLE_NAME
      );

      if (!hasRole) {
        await interaction.reply({
          content: `❌ You need the **${ADMIN_ROLE_NAME}** role to open the admin dashboard.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Mint an admin-typed token. The "admin" type is enforced
      // downstream by requireAdminSession and /auth/admin.
      const token = generateToken(userId, channelId, "admin");

      // Base URL resolution, in preference order:
      //   1. PUBLIC_URL   — explicit, set via fly.toml [env] on deploy
      //   2. FLY_APP_NAME — Fly.io injects this automatically, so we
      //                     can derive https://<app>.fly.dev as a
      //                     sensible zero-config fallback.
      // No onrender default — we're off Render as of the migration,
      // and pointing an admin link at a dead host would be worse
      // than failing loudly below.
      const baseUrl =
        process.env.PUBLIC_URL ||
        (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : "");

      if (!baseUrl) {
        await interaction.reply({
          content:
            "❌ Admin dashboard URL is not configured. Set `PUBLIC_URL` (or `FLY_APP_NAME`) on the bot host.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const dashboardUrl = `${baseUrl}/auth/admin?id=${userId}&code=${token}`;

      const embed = new EmbedBuilder()
        .setTitle("🛡️ Admin Dashboard")
        .setDescription(
          `Access the admin analytics dashboard:\n\n🔗 [Open Admin Dashboard](${dashboardUrl})\n\nYour link expires in **10 minutes**.`
        )
        .setColor(0xef4444)
        .setFooter({ text: "Coop's Collection — Admin Access" })
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });

      console.log(
        `🛡️ Admin dashboard token generated for ${interaction.user.username} (${userId})`
      );
    } catch (err) {
      console.error("❌ /admindashboard failed:", err);
      try {
        await interaction.followUp({
          content: "❌ Something went wrong generating your admin dashboard link.",
          flags: MessageFlags.Ephemeral,
        });
      } catch (e) {
        console.error("❌ followUp also failed inside /admindashboard:", e);
      }
    }
  },
};
