import { formatMessage } from "@/commands/study/Keyword";
import Select from "@/components/Select";
import Buttons from "@/components/practice/views/Buttons";
import { botYwResponses, tyAliases, ywAliases } from "@/data";
import {
	type IGuildPreferences,
	MessageOptOut,
	PrivateDmThread,
	Reputation,
} from "@/mongo";
import { DmGuildPreference } from "@/mongo/schemas/DmGuildPreference";
import { ReputationData } from "@/mongo/schemas/ReputationData";
import { ReputationQueue } from "@/mongo/schemas/ReputationQueue";
import {
	GuildPreferencesCache,
	KeywordCache,
	MessageOptOutCache,
	StickyMessageCache,
} from "@/redis";
import type { ICachedStickyMessage } from "@/redis/schemas/StickyMessage";
import { syncCommands } from "@/registry";
import { logToChannel } from "@/utils/Logger";
import { isBotDev } from "@/utils/isBotDev";
import sendDm from "@/utils/sendDm";
import { Logger } from "@discordforge/logger";
import {
	type APIEmbed,
	ActionRowBuilder,
	type ButtonBuilder,
	Colors,
	EmbedBuilder,
	Events,
	ForumChannel,
	type GuildMember,
	type GuildTextBasedChannel,
	type Message,
	type MessageCreateOptions,
	StringSelectMenuOptionBuilder,
	ThreadChannel,
	type User,
} from "discord.js";
import { v4 as uuidv4 } from "uuid";
import type { DiscordClient } from "../registry/DiscordClient";
import BaseEvent from "../registry/Structure/BaseEvent";

const stickyCounter: Record<string, number> = {};

export default class MessageCreateEvent extends BaseEvent {
	constructor() {
		super(Events.MessageCreate);
	}

	async execute(client: DiscordClient<true>, message: Message) {
		if (message.author.bot) return;
		if (message.system) return;
		if (
			message.guildId &&
			process.env.BLACKLISTED_GUILDS?.split(" ").includes(message.guildId)
		)
			return;

		if (message.content === "!sync_commands") {
			if (!(await isBotDev(client, message.author.id))) {
				return;
			}

			await syncCommands(client)
				.then(() => {
					Logger.info(
						`Synced application commands globally (by ${message.author.displayName})`,
					);
					message.reply("Succesfully synced commands.");
				})
				.catch((e) => {
					Logger.error(
						`Error syncing application commands globally (by ${message.author.displayName}): ${e}`,
					);
					message.reply("Error syncing commands.");
				});

			return;
		}

		if (await MessageOptOutCache.get(message.author.id)) return;

		if (message.inGuild()) {
			const keyword = message.content.trim().toLowerCase();
			const entry = await KeywordCache.get(message.guildId, keyword);
			if (entry.response) {
				const messageOptions = (await formatMessage(
					message,
					entry.response,
					false,
					keyword,
					entry.imageLink,
				)) as MessageCreateOptions;
				messageOptions.flags = undefined;
				await message.channel.send(messageOptions);
			}

			const guildPreferences = await GuildPreferencesCache.get(
				message.guild.id,
			);

			if (!guildPreferences) return;

			if (
				guildPreferences.countingChannelId &&
				message.channel.id === guildPreferences.countingChannelId
			) {
				const countingChannel = message.guild.channels.cache.get(
					guildPreferences.countingChannelId,
				);

				if (!countingChannel || !countingChannel.isTextBased()) return;

				const lastMessage = [
					...(
						await countingChannel.messages.fetch({
							before: message.id,
							limit: 1,
						})
					).values(),
				][0];

				if (
					((!lastMessage && message.content === "1") ||
						(lastMessage &&
							`${Number.parseInt(lastMessage.content) + 1}` ===
								message.content)) &&
					lastMessage.author.id !== message.author.id
				)
					message.react("✅");
				else message.delete();
			}

			if (guildPreferences.repEnabled)
				this.handleRep(
					client,
					message,
					guildPreferences.repDisabledChannelIds,
				);

			if (client.stickyChannelIds.includes(message.channelId)) {
				if (
					stickyCounter[message.channelId] === 10 &&
					stickyCounter[message.channelId] >= 10
				) {
					this.handleStickyMessages(message).catch((e) =>
						Logger.error(`Error at handleStickyMessages: ${e}`),
					);
					stickyCounter[message.channelId] = 0;
				} else {
					stickyCounter[message.channelId] = ((x: number) =>
						(Number.isNaN(x) ? 0 : x) + 1)(
						stickyCounter[message.channelId],
					);
				}
			}

			if (message.channelId === guildPreferences.modmailCreateChannelId) {
				if (
					!guildPreferences.modmailThreadsChannelId ||
					!guildPreferences.modmailCreateChannelId
				) {
					await message.reply(
						"Modmail is not set up in this server.",
					);
					return;
				}

				const member = await message.guild.members
					.fetch(message.content)
					.catch(async () => {
						await message.reply("Invalid User ID");
						return;
					});

				if (!member) return;

				const res = await PrivateDmThread.findOne({
					userId: member.id,
					guildId: message.guild.id,
				});

				if (res) {
					const thread = await message.guild.channels
						.fetch(res.threadId)
						.catch(async () => {
							await PrivateDmThread.deleteMany({
								userId: member.id,
								guildId: message.guild.id,
							});
							await message.reply(
								"Thread not found (could've been manually deleted), please try again to create a new thread.",
							);
							return;
						});

					if (thread) {
						await message.reply(
							`DM Thread with this user already exists: <#${thread.id}>`,
						);

						return;
					}
				}

				const threadsChannel = message.guild.channels.cache.get(
					guildPreferences.modmailThreadsChannelId,
				);

				if (
					!threadsChannel ||
					!(threadsChannel instanceof ForumChannel)
				) {
					await message.reply(
						`Threads channel (${threadsChannel}) should be a forum channel.`,
					);
					return;
				}

				try {
					const newThread = await threadsChannel.threads.create({
						name: `${member.user.tag} (${member.id})`,
						message: {
							content: `Username: \`${member.user.tag}\`\nUser ID: \`${member.id}\``,
						},
					});

					await PrivateDmThread.create({
						userId: member.id,
						threadId: newThread.id,
						guildId: message.guild.id,
					});

					await message.reply(
						`Created dm thread for user at <#${newThread.id}>.`,
					);
				} catch (error) {
					await message.reply("Unable to create thread");

					client.log(
						error,
						"Create DM Thread",
						`**Channel:** <#${message.channel?.id}>
							**User:** <@${message.author.id}>
							**Guild:** ${message.guild.name} (${message.guildId})\n`,
					);
				}
			}
			if (
				message.channel instanceof ThreadChannel &&
				message.channel.parentId ===
					guildPreferences.modmailThreadsChannelId
			) {
				this.handleModMailReply(client, message as Message<true>);
			}
		} else this.handleModMail(client, message as Message<false>);
	}

	private async handleModMail(
		client: DiscordClient<true>,
		message: Message<false>,
	) {
		let guildId = "";

		const dmPreference = await DmGuildPreference.findOne({
			userId: message.author.id,
		});

		if (dmPreference) guildId = dmPreference.guildId;
		else {
			const guilds = client.guilds.cache.filter((guild) =>
				guild.members.cache.has(message.author.id),
			);
			if (guilds.size === 0) {
				await message.author.send(
					"Hey there, please send a message in the server you're trying to contact and then try again.",
				);
				return;
			}
			const selectCustomId = uuidv4();
			const guildSelect = new Select(
				"guildSelect",
				"Select a server",
				guilds.map((guild) => {
					return new StringSelectMenuOptionBuilder()
						.setLabel(guild.name)
						.setValue(guild.id);
				}),
				1,
				`${selectCustomId}_0`,
			);

			const row = new ActionRowBuilder<Select>().addComponents(
				guildSelect,
			);

			const selectInteraction = await message.author.send({
				content: `Welcome to Modmail! Please select a server to contact using the dropdown menu below.
If you don't see the server you're looking for, please send a message in that server and try again.

To change the server you're contacting, use the \`/swap\` command`,
				components: [
					row,
					new Buttons(
						selectCustomId,
					) as ActionRowBuilder<ButtonBuilder>,
				],
			});

			const guildResponse = await guildSelect.waitForResponse(
				`${selectCustomId}_0`,
				selectInteraction,
				selectInteraction,
				true,
			);

			if (!guildResponse || guildResponse === "Timed out") return;
			const guild = client.guilds.cache.get(guildResponse[0]);

			if (!guild) {
				await selectInteraction.edit({
					content: "Invalid Server",
					components: [],
				});
				return;
			}

			await selectInteraction.edit({
				content: `Server ${guild.name} selected.`,
				components: [],
			});

			guildId = guildResponse[0];

			await DmGuildPreference.create({
				userId: message.author.id,
				guildId: guildId,
			});
		}

		const guild = client.guilds.cache.get(guildId);
		if (!guild) return;

		const guildPreferences = await GuildPreferencesCache.get(guildId);

		if (!guildPreferences || !guildPreferences.modmailThreadsChannelId) {
			await message.author.send(
				`Modmail is not set up in **${guild.name}**`,
			);
			return;
		}

		const channel = guild.channels.cache.get(
			guildPreferences.modmailThreadsChannelId,
		);

		if (!channel || !(channel instanceof ForumChannel)) {
			await message.author.send(
				`Unable to find the modmail channel in **${guild.name}**. Please contact the server staff.`,
			);
			return;
		}
		const res = await PrivateDmThread.findOne({
			userId: message.author.id,
			guildId,
		});

		let thread: ThreadChannel;

		if (res) {
			if (res.oneWay) {
				await message.author.send(
					`The moderators of **${guild.name}** have set your modmail thread to one-way. This means you can only receive messages, but not send messages.`,
				);
				return;
			}
			thread = (await channel.threads.fetch(
				res.threadId,
			)) as ThreadChannel;
		} else {
			thread = await channel.threads.create({
				name: `${message.author.username} (${message.author.id})`,
				message: {
					content: `Username: \`${message.author.tag}\`\nUser ID: \`${message.author.id}\``,
				},
			});
			await PrivateDmThread.create({
				userId: message.author.id,
				threadId: thread.id,
				guildId,
			});

			await message.author.send(
				`Hello and welcome to ModMail! Whenever you a send message here, it will be sent to the moderators of a selected server. **Please be mindful of what you send**.`,
			);
		}

		const embed = new EmbedBuilder()
			.setTitle("New DM Received")
			.setAuthor({
				name: message.author.username,
				iconURL: message.author.displayAvatarURL(),
			})
			.setDescription(message.content || "No content")
			.setTimestamp(message.createdTimestamp)
			.setColor(Colors.Red);

		if (message.attachments.size > 0) {
			embed.addFields({
				name: "Attachments",
				value: message.attachments
					.map(
						(attachment) =>
							`[${attachment.name}](${attachment.url})`,
					)
					.join("\n"),
			});
		}

		if (guildPreferences.modmailLogsChannelId) {
			logToChannel(guild, guildPreferences.modmailLogsChannelId, {
				embeds: [
					{
						title: "New DM Received",
						description: `**User:** ${message.author.tag} (${message.author.id})\n**Thread:** <#${thread.id}>`,
						color: Colors.Purple,
						timestamp: new Date().toISOString(),
					},
				],
			});
		}

		thread.send({
			embeds: [embed],
		});

		await message.react("📨");
	}

	private async handleSetOneWay(
		client: DiscordClient<true>,
		user: User,
		thread: GuildTextBasedChannel,
	) {
		await PrivateDmThread.findOneAndUpdate(
			{
				userId: user.id,
			},
			{
				oneWay: true,
			},
		);

		await thread.edit({
			name: `${user.tag} (${user.id}) (One-Way)`,
		});
	}

	private async handleUnsetOneWay(
		client: DiscordClient<true>,
		user: User,
		thread: GuildTextBasedChannel,
	) {
		await PrivateDmThread.findOneAndUpdate(
			{
				userId: user.id,
			},
			{
				oneWay: false,
			},
		);

		await thread.edit({
			name: `${user.tag} (${user.id})`,
		});
	}

	private async handleSetOneWay(
		client: DiscordClient<true>,
		user: User,
		thread: GuildTextBasedChannel,
	) {
		await PrivateDmThread.findOneAndUpdate(
			{
				threadId: thread.id,
			},
			{
				oneWay: true,
			},
		);

		await thread.edit({
			name: `${user.tag} (${user.id}) (One-Way)`,
		});
	}

	private async handleUnsetOneWay(
		client: DiscordClient<true>,
		user: User,
		thread: GuildTextBasedChannel,
	) {
		await PrivateDmThread.findOneAndUpdate(
			{
				threadId: thread.id,
			},
			{
				oneWay: false,
			},
		);

		await thread.edit({
			name: `${user.tag} (${user.id})`,
		});
	}

	private async handleModMailDelete(
		client: DiscordClient<true>,
		user: GuildMember | User,
		numDelete = 1,
	) {
		const channel = await user.createDM();
		const messages = (await channel.messages.fetch({ limit: 100 })).filter(
			(m) => m.author.id === client.user.id,
		);
		for (const msg of messages) {
			if (numDelete <= 0) break;
			// biome-ignore lint/style/noParameterAssign: cuz
			numDelete--;
			await msg[1].delete();
		}
	}

	private async handleModMailReply(
		client: DiscordClient<true>,
		message: Message<true>,
	) {
		if (
			!message.content.startsWith("//") &&
			!message.content.startsWith("!!")
		) {
			await message.react("👀");
			return;
		}

		const dmThread = await PrivateDmThread.findOne({
			threadId: message.channel.id,
		});

		if (!dmThread) {
			await message.reply("Unable to find the user for this thread.");
			return;
		}

		const member = await message.guild.members
			.fetch(dmThread.userId)
			.catch(() => null);
		const user =
			member?.user ??
			(await client.users.fetch(dmThread.userId).catch(() => null));
		if (!user) {
			await message.reply("Unable to find the user.");
			return;
		}

		if (message.content.startsWith("!!")) {
			const fullCommand = message.content.split(" ");
			const command = fullCommand[1];
			const args = fullCommand.slice(2);

			switch (command) {
				case "delete": {
					let numDelete: number;
					if (args && args.length > 0) {
						numDelete = Number(args[0]);
					} else {
						numDelete = 1;
					}
					this.handleModMailDelete(client, user, numDelete);
					await message.react("☑");
					break;
				}
				case "set_oneway": {
					try {
						await this.handleSetOneWay(
							client,
							user,
							message.channel,
						);
					} catch (error) {
						await message.reply(
							"An error occurred while setting one-way status.",
						);
						client.log(
							error,
							"Set One-Way ModMail",
							`**Channel:** <#${message.channel?.id}>
              **User:** <@${message.author.id}>
              **Guild:** ${message.guild.name} (${message.guildId})\n`,
						);
						return;
					}
					await message.react("☑");
					break;
				}
				case "unset_oneway": {
					try {
						await this.handleUnsetOneWay(
							client,
							user,
							message.channel,
						);
					} catch (error) {
						await message.reply(
							"An error occurred while unsetting one-way status.",
						);
						client.log(
							error,
							"Unset One-Way ModMail",
							`**Channel:** <#${message.channel?.id}>
              **User:** <@${message.author.id}>
              **Guild:** ${message.guild.name} (${message.guildId})\n`,
						);
						return;
					}
					await message.react("☑");
					break;
				}
			}
		} else {
			const embed = new EmbedBuilder()
				.setTitle(`Message from ${message.guild.name} Staff`)
				.setAuthor({
					name: message.content.startsWith("//!")
						? `${message.guild.name} Moderators`
						: message.author.username,
					iconURL: message.content.startsWith("//!")
						? message.guild.iconURL() || undefined
						: message.author.displayAvatarURL(),
				})
				.setDescription(
					message.content?.replace(/^\/\/!?/, "").trim() ||
						"No content",
				)
				.setTimestamp(message.createdTimestamp)
				.setColor(Colors.Green);

			if (message.attachments.size > 0) {
				embed.addFields({
					name: "Attachments",
					value: message.attachments
						.map(
							(attachment) =>
								`[${attachment.name}](${attachment.url})`,
						)
						.join("\n"),
				});
			}

			if (member) {
				await sendDm(member, {
					embeds: [embed],
				});
			} else {
				await user.send({
					embeds: [embed],
				});
			}

			await message.react(message.content.startsWith("//!") ? "☑" : "✅");
		}
	}

	private async handleRep(
		client: DiscordClient<true>,
		message: Message<true>,
		repDisabledChannels: string[],
	) {
		const channelId =
			(message.channel.isThread() && !message.channel.isThreadOnly()
				? message.channel.parentId
				: message.channelId) ?? "";

		if (repDisabledChannels.includes(channelId)) return;

		for (const user of await this.getReppedUsers(client, message)) {
			if (user.id === client.user.id) {
				await message.reply(
					botYwResponses[
						Math.floor(Math.random() * botYwResponses.length)
					],
				);

				continue;
			}

			const member = await message.guild.members.fetch(user.id);

			if (!member) return;

			let rep = 1;

			const res = await Reputation.findOneAndUpdate(
				{
					guildId: message.guildId,
					userId: member.id,
				},
				{
					$inc: {
						rep: 1,
					},
				},
			);

			if (res) rep = res.rep + 1;
			else
				await Reputation.create({
					guildId: message.guildId,
					userId: member.id,
					rep: 1,
				});

			const repData = await ReputationData.create({
				guildId: message.guildId,
				channelId: message.channelId,
				when: new Date(),
				repNumber: rep,
				reppedUser: member.id,
				reppedBy: user.reppedBy ?? message.author.id,
			}).catch((e) =>
				Logger.error(`Error creating ReputationData: ${e}`),
			);

			if (!repData) {
				Logger.error(
					`Failed to create ReputationData for ${member.id} in guild ${message.guildId}`,
				);
				return;
			}

			// get last convo between repped user and rep giver in the channel
			const messages = (
				await message.channel.messages.fetch({ limit: 50 })
			).filter(
				(msg) =>
					msg.author.id === member.id ||
					msg.author.id === message.author.id ||
					msg.author.id === user.reppedBy,
			);

			const tenMinsAgo = Date.now() - 10 * 60 * 1000;

			const recentMessages = Array.from(messages.values())
				.filter(
					(msg) =>
						msg.createdTimestamp >= tenMinsAgo &&
						msg.createdTimestamp <= message.createdTimestamp,
				)
				.reverse();

			if (recentMessages.length === 0) return;
			let startIndex = 0;

			for (let i = 0; i < recentMessages.length; i++) {
				const msg = recentMessages[i];

				const otherUserId =
					msg.author.id === message.author.id
						? member.id
						: message.author.id;

				const isReplyingToOther =
					msg.reference &&
					msg.mentions.repliedUser?.id === otherUserId;
				const isPingingOther = msg.mentions.users.has(otherUserId);

				if (isReplyingToOther || isPingingOther) {
					if (isReplyingToOther && i > 0 && message.reference) {
						startIndex = recentMessages.findIndex(
							(m) => m.id === msg.reference?.messageId,
						);
						if (startIndex === -1) startIndex = i;
					} else {
						startIndex = i;
					}
					break;
				}
			}

			const relevantMessages = recentMessages.slice(startIndex);

			// don't include messages authored by users who opted out of the bot seeing their messages
			const optedOutUsers = new Set(
				(
					await MessageOptOut.find({
						userId: {
							$in: [member.id, user.reppedBy].filter(
								Boolean,
							) as string[],
						},
					}).select("userId")
				).map((optOut) => optOut.userId),
			);

			const conversation: {
				author: string;
				content: string;
				attachmentUrls: string[];
			}[] = relevantMessages
				.filter((msg) => !optedOutUsers.has(msg.author.id))
				.map((msg) => ({
					// anonymize by using Asker and Responder instead of actual usernames
					author:
						msg.author.id === user.reppedBy ? "Asker" : "Responder",
					content: msg.content,
					attachmentUrls: msg.attachments.map((a) => a.url),
				}));

			if (conversation.length > 0)
				await ReputationQueue.create({
					reputationDataObjectId: repData._id.toString(),
					input: conversation,
				}).catch((e) =>
					Logger.error(`Error creating ReputationQueue: ${e}`),
				);

			let content = `Gave +1 Rep to <@${user.id}> (${rep})`;

			if ([100, 500, 1000, 5000, 10000].some((amnt) => rep === amnt)) {
				const role = message.guild.roles.cache.find(
					(x) => x.name === `${rep}+ Rep Club`,
				);

				if (role) {
					content += `\nWelcome to the ${role.name}`;
					member.roles.add(role);
				}
			}

			message.channel.send({
				content,
				allowedMentions: { repliedUser: false },
			});
		}
	}

	private async getReppedUsers(
		client: DiscordClient<true>,
		message: Message,
	) {
		interface ReppedUser extends User {
			reppedBy?: string | null;
			repType?: "yw" | "ty";
		}
		const users = new Set<ReppedUser>();

		if (
			tyAliases.some((alias) =>
				new RegExp(`\\b${alias}\\b`, "gi").test(message.content),
			)
		) {
			for (const user of message.mentions.users.values())
				if (message.author.id === user.id)
					message.reply("You can't rep yourself dummy!");
				else if (user.bot) message.reply("Uh-oh, you can't rep a bot");
				else {
					const reppedUser = user as ReppedUser;
					reppedUser.repType = "ty";
					reppedUser.reppedBy = message.author.id;
					users.add(reppedUser);
				}

			if (message.reference) {
				const reference = await message.fetchReference();

				if (message.author.id === reference.author.id)
					message.reply("You can't rep yourself dummy!");
				else if (reference.author.bot)
					message.reply("Uh-oh, you can't rep a bot");
				else {
					const reppedUser = reference.author as ReppedUser;
					reppedUser.repType = "ty";
					reppedUser.reppedBy = message.author.id;
					users.add(reppedUser);
				}
			}
		} else if (
			message.reference &&
			ywAliases.some((alias) =>
				new RegExp(`\\b${alias}\\b`, "gi").test(message.content),
			)
		) {
			const reference = await message.fetchReference();

			if (reference.author.id === message.author.id)
				message.reply(
					Math.random() > 0.5
						? "Gave +1 Rep to-wait what you can't just rep yourself"
						: "You can't rep yourself dummy!",
				);
			else if (reference.author.id === client.user.id)
				message.reply(
					Math.random() > 0.5
						? "Gave +1 Rep to-yeah no you don't get to do that"
						: "I never said thanks",
				);
			else if (reference.author.bot)
				message.reply(
					Math.random() > 0.5
						? "Gave +1 Rep to-oh wait you can't rep my kind"
						: "Uh-oh, you can't get rep from a bot",
				);
			else {
				const referenceRepped = await this.getReppedUsers(
					client,
					reference,
				);

				if (!referenceRepped.has(message.author)) {
					const reppedUser = message.author as ReppedUser;
					reppedUser.repType = "yw";
					reppedUser.reppedBy = reference.author.id;
					users.add(reppedUser);
				}
			}
		}

		return users;
	}

	private async handleStickyMessages(message: Message<true>) {
		const stickyMessages = (await StickyMessageCache.search()
			.where("channelId")
			.equals(message.channelId)
			.returnAll()
			.catch(() => [])) as ICachedStickyMessage[];

		for (const stickyMessage of stickyMessages) {
			if (stickyMessage.messageId) {
				await message.channel.messages
					.delete(stickyMessage.messageId)
					.catch(() => {});
			}

			const newSticky = await message.channel.send({
				content: ((x) => (x === "" ? undefined : x))(
					stickyMessage.message.content,
				),
				embeds: stickyMessage.message.embeds as APIEmbed[],
			});

			stickyMessage.messageId = newSticky.id;
			await StickyMessageCache.save(stickyMessage);
		}
	}
}
