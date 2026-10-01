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
	PermissionFlagsBits,
	SlashCommandBuilder,
	MessageFlags,
    InteractionContextType,
    ApplicationIntegrationType,
	type AutocompleteInteraction,
} from "discord.js";
import { Logger } from "@discordforge/logger";
import { infractionAutoComplete } from "../infractionAutoComplete";

export default class BanCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("ban")
				.setDescription("Ban a user from the server (for mods)")
				.addUserOption((option) =>
					option
						.setName("user")
						.setDescription("User to ban")
						.setRequired(true),
				)
				.addStringOption((option) =>
					option
						.setName("reason")
						.setDescription("Reason for ban")
						.setRequired(true)
						.setAutocomplete(true),
				)
				.addIntegerOption((option) =>
					option
						.setName("delete_messages")
						.setDescription("Days to delete messages for")
						.setMaxValue(7)
						.setMinValue(0)
						.setRequired(false),
				)
				.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
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
		const deleteMessagesDays =
			interaction.options.getInteger("delete_messages", false) ?? 0;

		await interaction.deferReply({
			flags: MessageFlags.Ephemeral,
		});

		if (user.id === interaction.user.id) {
			const error = new EmbedBuilder()
				.setTitle(":lock: Wanna leave so badly?")
				.setDescription("As much as I'd like to let you, you can't ban yourself. Though you can try ask someone else!")
				.setColor(Colors.Red);
			interaction.editReply({
				embeds: [error],
			});
			return;
		}

		if (await interaction.guild.bans.fetch(user.id).catch(() => null)) {
			const error = new EmbedBuilder()
				.setTitle(":lock: What a trouble maker")
				.setDescription("I can't ban a user who is already banned.")
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
			await interaction.editReply({
				content:
					"Please configure the bot using `/setup` command first.",
			});
			return;
		}

		const dmEmbed = new EmbedBuilder()
			.setTitle(":hammer: Banned")
			.setTimestamp()
			.setDescription(
				`You have been banned from **${
					interaction.guild.name
				}** due to \`${reason}\`. ${
					guildPreferences.banAppealFormLink
						? `Please fill the appeal form [here](${guildPreferences.banAppealFormLink}) to appeal your ban.`
						: ""
				}`,
			)
			.setColor(Colors.Red);

		const guildMember = await interaction.guild.members
			.fetch(user.id)
			.catch((e) => null);

		if (guildMember) {
			if (!guildMember.bannable) {
				const error = new EmbedBuilder()
					.setTitle(":lock: What are you doing?")
					.setDescription("I cannot ban this user.")
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
			await sendDm(guildMember, {
				embeds: [dmEmbed],
			});
		}

		try {
			await interaction.guild.bans.create(user, {
				reason: `${reason} | By: ${interaction.user.tag} `,
				deleteMessageSeconds: deleteMessagesDays * 86400,
			});
		} catch (error) {
			interaction.editReply({
				content: `Failed to ban user ${
					error instanceof Error ? `(${error.message})` : ""
				}`,
			});

			client.log(
				error,
				`${this.data.name} Command`,
				`
	* * Channel:** <#${interaction.channel?.id} >
					**User:** <@${interaction.user.id}>
					**Guild:** ${interaction.guild.name} (${interaction.guildId})\n`,
			);

			return;
		}

		const caseNumber =
			(
				await Punishment.find({
					guildId: interaction.guildId,
				})
			).length + 1;

		Punishment.create({
			guildId: interaction.guild.id,
			actionAgainst: user.id,
			actionBy: interaction.user.id,
			action: "Ban",
			caseId: caseNumber,
			reason,
			points: 0,
			when: new Date(),
		});

		interaction.channel.send(
			`:hammer: ${user.username} has been banned. (Case #${caseNumber})`,
		);

		if (guildPreferences.modlogChannelId) {
			const modEmbed = new EmbedBuilder()
				.setTitle(`:hammer: Ban | Case #${caseNumber}`)
				.setColor(Colors.Red)
				.setTimestamp()
				.setThumbnail(user.displayAvatarURL())
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
				.setTimestamp();

			logToChannel(interaction.guild, guildPreferences.modlogChannelId, {
				embeds: [modEmbed],
			});
		}

		interaction.editReply({
			content:
				"https://giphy.com/gifs/ban-banned-admin-fe4dDMD2cAU5RfEaCU",
		});
	}

	async autoComplete(interaction: AutocompleteInteraction) {
			await infractionAutoComplete(interaction);
		}
}