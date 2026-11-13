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
import { generateToken } from "../utils/dashboardAuth.js";
import { publicBaseUrl } from "../utils/publicUrl.js";

const ADMIN_ROLE_NAME = process.env.ADMIN_ROLE_NAME || "Developer";

export default {
  data: new SlashCommandBuilder()
    .setName("admindashboard")
    .setDescription("Open the admin dashboard to manage players (Developer role)."),

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
      const token = generateToken(userId, channelId, "admin", { name: interaction.user.username });

      // Same base URL as /dashboard and embed images (utils/publicUrl.js):
      // PUBLIC_URL, then FLY_APP_NAME, then the production host.
      const baseUrl = publicBaseUrl();

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
        .setTitle("Admin dashboard")
        .setDescription(
          `[Open the admin dashboard](${dashboardUrl})\n\nThe link works for 10 minutes. Once open, the session lasts 30 minutes after your last action, up to 4 hours.`
        )
        .setColor(0xef4444)
        .setFooter({ text: "Coop's Collection · Admin access" })
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
