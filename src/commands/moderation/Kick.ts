import { Punishment } from "@/mongo";
import { GuildPreferencesCache, InfractionsCache } from "@/redis";
import type { DiscordClient } from "@/registry/DiscordClient";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "@/registry/Structure/BaseCommand";
import { logToChannel } from "@/utils/Logger";
import sendDm from "@/utils/sendDm";
import {
	Colors,
	EmbedBuilder,
	ApplicationIntegrationType,
	PermissionFlagsBits,
	InteractionContextType,
	SlashCommandBuilder,
	MessageFlags,
	type AutocompleteInteraction,
} from "discord.js";
import { Logger } from "@discordforge/logger";
import { infractionAutoComplete } from "../moderation/infractionAutoComplete";

export default class KickCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("kick")
				.setDescription("Kick a user from the server (for mods)")
				.addUserOption((option) =>
					option
						.setName("user")
						.setDescription("User to kick")
						.setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName("reason")
						.setDescription("Reason for kick")
						.setRequired(true)
						.setAutocomplete(true),
				)
				.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
				.setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
		);
	}

	async execute(
		client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction<"cached">,
	) {
		if (!interaction.channel || !interaction.channel.isTextBased()) return;

		const user = interaction.options.getUser("user", true);
		const reason = interaction.options.getString("reason", true);

		// defer message
		await interaction.deferReply({
			flags: MessageFlags.Ephemeral,
		})

		if (user.id === interaction.user.id) {
			const error = new EmbedBuilder()
				.setTitle(":lock: What are you doing?")
				.setDescription("You cannot kick yourself, ||consider leaving the server instead||.")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		const guildPreferences = await GuildPreferencesCache.get(
			interaction.guildId,
		);

		if (!guildPreferences) {
			interaction.editReply({
				content:
					"Please setup the bot using the command `/setup` first.",
			});
			return;
		}

		const caseNumber =
			(
				await Punishment.find({
					guildId: interaction.guildId,
				})
			).length + 1;

		const guildMember = interaction.guild.members.cache.get(user.id);
		if (!guildMember) return;

		if (!guildMember.kickable) {
			const error = new EmbedBuilder()
				.setTitle(":lock: No Permission")
				.setDescription("I am not able to kick this user.")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		const memberHighestRole = guildMember.roles.highest;
		const modHighestRole = interaction.member.roles.highest;

		// member role is higher than the moderators role
		// ensure that server owners bypass this check
		if (memberHighestRole.comparePositionTo(modHighestRole) >= 0 && (interaction.user.id !== interaction.guild.ownerId)) {
			const error = new EmbedBuilder()
				.setTitle(":lock: No Permission")
				.setDescription("You are not allowed to kick this user as their role is higher than or equal to yours.")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		sendDm(guildMember, {
			embeds: [
				new EmbedBuilder()
					.setTitle(":hammer: Kicked")
					.setColor(Colors.Red)
					.setTimestamp()
					.setDescription(
						`You have been kicked from **${interaction.guild.name}** for: \`${reason}\`.`,
					),
			],
		});

		try {
			await interaction.guild.members.kick(user, reason);
		} catch (error) {
			interaction.editReply({
				content: `Failed to kick user ${
					error instanceof Error ? `(${error.message})` : ""
				}`,
			});

			client.log(
				error,
				`${this.data.name} Command`,
				`**Channel:** <#${interaction.channel?.id}>
					**User:** <@${interaction.user.id}>
					**Guild:** ${interaction.guild.name} (${interaction.guildId})\n`,
			);
		}

		Punishment.create({
			guildId: interaction.guild.id,
			actionAgainst: user.id,
			actionBy: interaction.user.id,
			action: "Kick",
			caseId: caseNumber,
			reason,
			points: 0,
			when: new Date(),
		});

		if (guildPreferences.modlogChannelId) {
			const modEmbed = new EmbedBuilder()
				.setTitle(`:hammer: Kick | Case #${caseNumber}`)
				.setColor(Colors.Red)
				.addFields([
					{
						name: "User",
						value: `${user.tag} (${user.id})`,
						inline: false,
					},
					{
						name: "Moderator",
						value: `${interaction.user.tag} (${interaction.user.id})`,
						inline: false,
					},
					{
						name: "Reason",
						value: reason,
					},
				])
				.setThumbnail(user.displayAvatarURL())
				.setTimestamp();

			logToChannel(interaction.guild, guildPreferences.modlogChannelId, {
				embeds: [modEmbed],
			});
		}

		interaction.channel.send(
			`${user.username} has been kicked. (Case #${caseNumber})`,
		);
	}

	async autoComplete(interaction: AutocompleteInteraction) {
		await infractionAutoComplete(interaction);
	}
}