import type { PublicChannelInput } from '../../interfaces/channels';
export type { PublicChannelInput };
import type { PublicChannel, } from '../shared/channels';

export type PublicChannelEntry = PublicChannel;

export type PublicChannelUpdate = Partial<Omit<PublicChannelInput, 'kind' | 'mailbox_id'>>;
