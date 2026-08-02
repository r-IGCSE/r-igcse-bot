import type { DiscordClient } from "@/registry/DiscordClient";
import {
    ApplicationIntegrationType,
	ChannelType,
	InteractionContextType,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import BaseCommand, {
	type DiscordChatInputCommandInteraction,
} from "../../registry/Structure/BaseCommand";
import parse from "parse-duration";

export default class RecordSessionCommand extends BaseCommand {
	constructor() {
		super(
			new SlashCommandBuilder()
				.setName("record_session")
				.setDescription("Record a study session (mod only)")
				.addChannelOption((option) =>
					option
						.setName("channel")
						.setDescription("The voice/stage channel to record")
						.setRequired(true)
						.addChannelTypes(
							ChannelType.GuildVoice,
							ChannelType.GuildStageVoice,
						),
				)
				.addStringOption((option) =>
					option
						.setName("duration")
						.setDescription("The maximum duration of the recording")
						.setRequired(true),
				)
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.setContexts(InteractionContextType.Guild)
				.setIntegrationTypes(ApplicationIntegrationType.GuildInstall),
		);
	}

	async execute(
		client: DiscordClient<true>,
		interaction: DiscordChatInputCommandInteraction,
	) {
		if (
			!interaction.guild ||
			(interaction.guildId !== process.env.MAIN_GUILD_ID &&
				interaction.guildId !== "230296179991248896")
		) {
			await interaction.reply({
				content: "This command is not enabled in this server.",
				ephemeral: true,
			});
			return;
		}

		const channel = interaction.options.getChannel("channel", true);
		const duration = interaction.options.getString("duration", true);

		if (
			channel.type !== ChannelType.GuildVoice &&
			channel.type !== ChannelType.GuildStageVoice
		) {
			await interaction.reply({
				content: "Please select a voice or stage channel.",
				ephemeral: true,
			});
			return;
		}

		if (parse(duration) === null) {
			await interaction.reply({
				content: "Please enter a valid duration (e.g. 1h30m, 45m, 2h).",
				ephemeral: true,
			});
			return;
		}

		await interaction.deferReply();

		const res = await fetch(
			`${process.env.PORTAINER_API_URL}/api/endpoints/3/docker/containers/create?name=rigrecorder`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-API-Key": process.env.PORTAINER_API_KEY || "",
				},
				body: JSON.stringify({
					Image: "chiraglol/recorder:latest",
					Env: [`DISCORD_TOKEN=${process.env.RECORDING_TOKEN}`],
					HostConfig: {
						AutoRemove: true,
						ShmSize: 2.5 * 1024 * 1024 * 1024, // 2.5 GB
						Memory: 2.5 * 1024 * 1024 * 1024, // 2.5 GB
						Binds: ["rig-recordings:/mnt/recordings"],
						NanoCpus: 3 * 1e9, // 3 cpus
					},
					Cmd: [
						"-c",
						channel.id,
						"-d",
						duration,
						"-g",
						interaction.guildId,
						"-w",
						process.env.RECORDING_WEBHOOK_URL,
					],
				}),
			},
		).catch(async (err) => {
			console.error(err);
			await interaction.editReply({
				content:
					"An unknown error occurred while starting the recording session. \n\n" +
					err,
			});
		});

		if (!res) {
			await interaction.editReply({
				content:
					"An unknown error occurred while starting the recording session.",
			});
			return;
		}

		const data = (await res.json()) as { Id: string } | { message: string };

		if (res.status !== 201 || !("Id" in data)) {
			console.error(data);
			await interaction.editReply({
				content:
					"An error occurred while starting the recording session. \n\n" +
					(JSON.stringify(data) ||
						"No additional information provided."),
			});
			return;
		}

		const startRes = await fetch(
			`${process.env.PORTAINER_API_URL}/api/endpoints/3/docker/containers/${data.Id}/start`,
			{
				method: "POST",
				headers: {
					"X-API-Key": process.env.PORTAINER_API_KEY || "",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			},
		).catch(async (err) => {
			console.error(err);
			await interaction.editReply({
				content:
					"An unknown error occurred while starting the recording session. \n\n" +
					err,
			});
		});

		if (!startRes) {
			await interaction.editReply({
				content:
					"An unknown error occurred while starting the recording session.",
			});
			return;
		}

		const startData = (await startRes.json()) as { message: string } | {};

		if (startRes.status !== 204) {
			console.error(startData);
			await interaction.editReply({
				content:
					"An error occurred while starting the recording session. \n\n" +
					(JSON.stringify(startData) ||
						"No additional information provided."),
			});
			return;
		}

		await interaction.editReply({
			content:
				"Recording session started successfully! The recording will automatically stop after the specified duration or when the session ends, whichever comes first.",
		});
	}
}
