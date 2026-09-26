import { ReactionRole } from "@/mongo";
import type { DiscordClient } from "@/registry/DiscordClient";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "@/registry/Structure/BaseCommand";
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	Colors,
	ComponentType,
	ApplicationIntegrationType,
	EmbedBuilder,
	Message,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	InteractionContextType,
	SnowflakeUtil,
} from "discord.js";
import { caieDiscussionForums, edexcelDiscussionForums } from "@/data";
import { v4 as uuidv4 } from "uuid";
import { GuildPreferencesCache } from "@/redis";
import { logToChannel } from "@/utils/Logger";

export default class CreateDiscussionForumCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("create_discussion_forum")
				.setDescription(
					"Create a forum with all discussion threads for the current exam session (for mods)",
				)
				.setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
				.addStringOption((option) =>
					option
						.setName("exam_session")
						.setDescription(
							"Current exam session (eg. May/June 2025)",
						)
						.setRequired(true),
				)
				.addRoleOption((option) =>
					option
						.setName("role")
						.setDescription("Exam session role")
						.setRequired(true),
				)
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
			true,
		);
	}

	async execute(
		client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction,
	) {
		if (!interaction.guildId) {
			await interaction.reply({
				content: "An error occurred.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const guildPreferences = await GuildPreferencesCache.get(
			interaction.guildId,
		);

		if (!guildPreferences?.modlogChannelId) {
			interaction.reply({
				content:
					"Please setup the bot using the command `/setup` first.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const examSessionUnformatted = interaction.options.getString(
			"exam_session",
			true,
		);
		const examSession = examSessionUnformatted.replace(/\//, " ");
		const role = interaction.options.getRole("role", true);
		const isMarch = examSession.toLowerCase().includes("march");

		const confirmationEmbed = new EmbedBuilder()
			.setTitle(`Create ${examSessionUnformatted} discussion channels`)
			.setDescription(
				`This will create channels, and discussion threads for the CAIE${isMarch ? "" : " and Edexcel"} ${examSessionUnformatted} session.\nThe session text will be used unchanged, ensure it's provided in the format \`<Start>/<End> <Year>\` (eg. May/June 2025).`,
			)
			.setColor(Colors.Red)
			.setAuthor({
				name: interaction.user.tag,
				iconURL: interaction.user.displayAvatarURL(),
			});

		const buttonCustomId = uuidv4();

		const confirmButton = new ButtonBuilder()
			.setCustomId(`confirm_${buttonCustomId}`)
			.setLabel("Confirm")
			.setStyle(ButtonStyle.Success);

		const cancelButton = new ButtonBuilder()
			.setCustomId(`cancel_${buttonCustomId}`)
			.setLabel("Cancel")
			.setStyle(ButtonStyle.Danger);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			confirmButton,
			cancelButton,
		);

		await interaction.reply({
			embeds: [confirmationEmbed],
			components: [row],
			flags: MessageFlags.Ephemeral,
		});

		if (!interaction.channel) {
			return;
		}

		const buttonResponse = await interaction.channel.awaitMessageComponent({
			filter: (i) => {
				i.deferUpdate();
				return (
					i.customId === `confirm_${buttonCustomId}` ||
					i.customId === `cancel_${buttonCustomId}`
				);
			},
			time: 300_000,
			componentType: ComponentType.Button,
		});

		if (buttonResponse.customId === `cancel_${buttonCustomId}`) {
			interaction.editReply({
				content: "Creation of discussion threads cancelled.",
				embeds: [],
				components: [],
			});
			return;
		}

		if (!interaction.guild?.channels) {
			await interaction.editReply({
				content: "An error occurred.",
				embeds: [],
				components: [],
			});
			return;
		}

		const logEmbed = new EmbedBuilder()
			.setAuthor({
				name: interaction.user.tag,
				iconURL: interaction.user.displayAvatarURL(),
			})
			.setTitle(`${examSessionUnformatted} Discussion Channels Created`)
			.setDescription(
				`${interaction.user} created discussion channels for the ${examSessionUnformatted} exam session`,
			)
			.setColor(Colors.Red)
			.setTimestamp();

		logToChannel(interaction.guild, guildPreferences.modlogChannelId, {
			embeds: [logEmbed],
		});

		const reactionChannel = await interaction.guild.channels.create({
			parent: process.env.GENERAL_HUB_ID,
			name: examSession,
			type: ChannelType.GuildText,
		});

		const policyEmbed = new EmbedBuilder()
			.setTitle(
				`The following are our policies regarding discussing of papers during the ${examSessionUnformatted} exam session`,
			)
			.setDescription(
				'Malpractice is strictly prohibited on our server, and is a bannable offense without prior warning. The following include, but are not limited to, what malpractice consists of:\n\n- Asking for exam leaks\n- Joking about having paper leaks\n- Sharing "fake" paper leaks as a joke\n- Encouraging malpractice/cheating\n- Actively engaging in cheating and sharing leaked papers\n- Discussing papers before the exam has been completed\n\nNo exam paper content is allowed to be shared for the time being until the results day. Our policies will be revised and restated closer to results day regarding when this content can be shared. *Note that each infraction is viewed on a case-by-case basis and the final decision is up to the moderators to make. Thank you for your cooperation.',
			);

		const reactEmbed = new EmbedBuilder()
			.setTitle(
				"Please react with the emoji below to show that you agree to the rules stated above:",
			)
			.setDescription(
				"This will give you access to the general discussion and paper discussion channels.\nThis also means you understand that you are obliged to follow the above rules.",
			);

		const reactMessage = await reactionChannel.send({
			embeds: [policyEmbed, reactEmbed],
		});

		reactMessage.react("✅");

		await ReactionRole.create({
			messageId: reactMessage.id,
			emoji: "✅",
			roleId: role.id,
		});

		const malpracticeEmbed = new EmbedBuilder()
			.setTitle("Rule 1")
			.setDescription(
				"Cheating (asking for leaks, answers or trying to find papers before they have been sat) is strictly prohibited and counts as **attempted malpractice.** __This includes official papers that are unreleased.__\n\nAsking for or sharing Edexcel papers which are less than two years old (that are not officially released by Edexcel) may lead to a warn or mute as per the directives given out by Pearson Education Ltd.\n\nFurthermore, any sort of malpractice, attempt at malpractice, or even encouraging others/joking to indulge in malpractice-based activities will result in consequences by the moderation of the server.",
			)
			.setColor(Colors.Red);

		const initialMessage = {
			content:
				"You may only discuss the papers in this channel **once the exam has been completed**. If we believe you have discussed the paper on the server before the exam has been completed, you will be subject to a ban for violating rule 1.",
			embeds: [malpracticeEmbed],
		};

		await interaction.editReply({
			content: `Created ${examSessionUnformatted} channels.`,
			embeds: [],
			components: [],
		});

		const caieDiscussion = await interaction.guild.channels.create({
			parent: process.env.GENERAL_HUB_ID,
			name: `caie-${examSession}-paper-discussion`,
			type: ChannelType.GuildForum,
			permissionOverwrites: [
				{
					id: interaction.guild.roles.everyone,
					deny: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.ManageThreads,
					],
				},
				{
					id: role.id,
					deny: [
						PermissionFlagsBits.ManageThreads,
						PermissionFlagsBits.SendMessages,
					],
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessagesInThreads,
					],
				},
				{
					id: process.env.MOD_ROLE_ID,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.ManageMessages,
						PermissionFlagsBits.ManageThreads,
					],
				},
			],
		});

		let caieVariants: string[][] = [];
		let totalCAIEThreads = 0;
		let completedCAIEThreads = 0;
		let caieCSV = "Subject,ID\n";
		let followUpMessage: Message;

		if (isMarch) {
			await caieDiscussion.setAvailableTags([
				{
					emoji: { name: "🟥" },
					name: "A-Level",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { name: "🟦" },
					name: "IGCSE",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { name: "🥼" },
					name: "AS/AL Practical",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
			]);

			caieVariants = [
				caieDiscussionForums.ALevel.FM,
				caieDiscussionForums.IGCSE.FM,
				caieDiscussionForums.ALevel.Practical,
			];

			followUpMessage = await interaction.followUp({
				content: `Creating CAIE ${examSession} discussion channels`,
			});

			for (const variant of caieVariants) {
				totalCAIEThreads += variant.length;
			}
		} else {
			await caieDiscussion.setAvailableTags([
				{
					emoji: { id: "1️⃣" },
					name: "AS/AL Variant 1",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { id: "2️⃣" },
					name: "AS/AL Variant 2",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { id: "3️⃣" },
					name: "AS/AL Variant 3",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { name: "1️⃣" },
					name: "IGCSE Variant 1",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { name: "2️⃣" },
					name: "IGCSE Variant 2",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { name: "3️⃣" },
					name: "IGCSE Variant 3",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { name: "🥼" },
					name: "AS/AL Practical",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
			]);

			caieVariants = [
				caieDiscussionForums.ALevel.Variant1,
				caieDiscussionForums.ALevel.Variant2,
				caieDiscussionForums.ALevel.Variant3,
				caieDiscussionForums.IGCSE.Variant1,
				caieDiscussionForums.IGCSE.Variant2,
				caieDiscussionForums.IGCSE.Variant3,
				caieDiscussionForums.ALevel.Practical,
			];
			const caieOtherVariants = [
				caieDiscussionForums.ALevel.Others,
				caieDiscussionForums.IGCSE.Others,
			];

			followUpMessage = await interaction.followUp({
				content: `Creating CAIE ${examSession} discussion channels`,
			});

			for (const variant of [caieOtherVariants, ...caieVariants]) {
				totalCAIEThreads += variant.length;
			}

			for (let i = 0; i < caieOtherVariants.length; i++) {
				for (const subject of caieOtherVariants[i]) {
					const thread = await caieDiscussion.threads.create({
						appliedTags: [
							caieDiscussion.availableTags[i * 3].id,
							caieDiscussion.availableTags[i * 3 + 1].id,
							caieDiscussion.availableTags[i * 3 + 2].id,
						],
						name: subject,
						message: initialMessage,
					});
					completedCAIEThreads++;
					caieCSV += `"${subject}","\`${thread.id}"\n`;
					followUpMessage.edit({
						content: `Creating CAIE forum\n${((completedCAIEThreads / totalCAIEThreads) * 100).toFixed(1)}% (${completedCAIEThreads}/${totalCAIEThreads}) (Creating ${i < 7 ? caieDiscussion.availableTags[i].name : "other"} threads)\nLast thread was created <t:${Math.round(new Date().getTime() / 1000)}:R>`,
					});
				}
			}
		}

		for (let i = 0; i < caieVariants.length; i++) {
			for (const subject of caieVariants[i]) {
				const thread = await caieDiscussion.threads.create({
					appliedTags: [caieDiscussion.availableTags[i].id],
					name: subject,
					message: initialMessage,
				});
				completedCAIEThreads++;
				caieCSV += `"${subject}","\`${thread.id}"\n`;
				followUpMessage.edit({
					content: `Creating CAIE forum\n${((completedCAIEThreads / totalCAIEThreads) * 100).toFixed(1)}% (${completedCAIEThreads}/${totalCAIEThreads}) (Creating ${i < 7 ? caieDiscussion.availableTags[i].name : "other"} threads)\nLast thread was created <t:${Math.round(new Date().getTime() / 1000)}:R>`,
				});
			}
		}

		const caieFinishTimestamp = Math.round(new Date().getTime() / 1000);

		let edexcelCSVAttachment: AttachmentBuilder | undefined = undefined;

		if (!isMarch) {
			const edexcelDiscussion = await interaction.guild.channels.create({
				parent: process.env.GENERAL_HUB_ID,
				name: `edexcel-${examSession}-paper-discussion`,
				type: ChannelType.GuildForum,
				permissionOverwrites: [
					{
						id: interaction.guild.roles.everyone,
						deny: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.ManageThreads,
						],
					},
					{
						id: role.id,
						deny: [
							PermissionFlagsBits.ManageThreads,
							PermissionFlagsBits.SendMessages,
						],
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.SendMessagesInThreads,
						],
					},
					{
						id: process.env.MOD_ROLE_ID,
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.ManageMessages,
							PermissionFlagsBits.ManageThreads,
						],
					},
				],
			});

			await edexcelDiscussion.setAvailableTags([
				{
					emoji: { name: "🟥" },
					name: "A-Level",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
				{
					emoji: { name: "🟦" },
					name: "IGCSE",
					moderated: true,
					id: SnowflakeUtil.generate().toString(),
				},
			]);

			const edexcelVariants = [
				edexcelDiscussionForums.ALevel,
				edexcelDiscussionForums.IGCSE,
			];

			let totalEdexcelThreads = 0;
			for (const variant of edexcelVariants) {
				totalEdexcelThreads += variant.length;
			}

			let completedEdexcelThreads = 0;

			let edexcelCSV = "Subject,ID\n\n";

			for (let i = 0; i < edexcelVariants.length; i++) {
				for (const subject of edexcelVariants[i]) {
					const thread = await edexcelDiscussion.threads.create({
						appliedTags: [edexcelDiscussion.availableTags[i].id],
						name: subject,
						message: initialMessage,
					});
					completedEdexcelThreads++;
					edexcelCSV += `"${subject}","\`${thread.id}"\n`;
					followUpMessage.edit({
						content: `Finished CAIE forum <t:${caieFinishTimestamp}:R>\n\nCreating Edexcel forum:\n${((completedEdexcelThreads / totalEdexcelThreads) * 100).toFixed(1)}% (${completedEdexcelThreads}/${totalEdexcelThreads}) (Creating ${i < 7 ? edexcelDiscussion.availableTags[i].name : "other"} threads)\nLast creation time <t:${Math.round(new Date().getTime() / 1000)}:R>`,
					});
				}
			}
			const edexcelCSVBuffer = Buffer.from(edexcelCSV);
			edexcelCSVAttachment = new AttachmentBuilder(edexcelCSVBuffer, {
				name: `${examSession} Edexcel IDs.csv`,
			});
		}

		const caieCSVBuffer = Buffer.from(caieCSV);
		const caieCSVAttachment = new AttachmentBuilder(caieCSVBuffer, {
			name: `${examSession} CAIE IDs.csv`,
		});

		followUpMessage.edit({
			content: `${examSessionUnformatted} discussion channels created [!](https://tenor.com/view/great-work-good-job-hired-remoteli-celebration-teamwork-gif-25782100)`,
			files: [
				caieCSVAttachment,
				...(edexcelCSVAttachment ? [edexcelCSVAttachment] : []),
			],
		});
	}
}
