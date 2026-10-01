import { createClient } from "redis";

import { ButtonInteractionRepository } from "./schemas/ButtonInteraction";
import { GuildPreferencesRepository } from "./schemas/GuildPreferences";
import { KeywordRepository } from "./schemas/Keyword";
import { PracticeQuestionRepository } from "./schemas/Question";
import { StickyMessageRepository } from "./schemas/StickyMessage";
import { ModPingRepository } from "./schemas/ModPing";
import { UserRepository } from "./schemas/User";
import { InfractionsRepository } from "./schemas/Infractions";

export const redis = createClient({
	url: process.env.REDIS_URL,
});

await redis.connect();

export const GuildPreferencesCache = new GuildPreferencesRepository(redis);
export const StickyMessageCache = new StickyMessageRepository(redis);
export const ModPingCache = new ModPingRepository(redis);
export const PracticeQuestionCache = new PracticeQuestionRepository(redis);
export const UserCache = new UserRepository(redis);
export const ButtonInteractionCache = new ButtonInteractionRepository(redis);
export const KeywordCache = new KeywordRepository(redis);
export const InfractionsCache = new InfractionsRepository(redis);