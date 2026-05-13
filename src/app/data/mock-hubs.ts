import type { HubNavItem } from '../models/hub';
import { HUB_DEFINITIONS } from './hub-definitions';

export const HUB_NAV_ITEMS: HubNavItem[] = HUB_DEFINITIONS.map((hub) => ({
  key: hub.key,
  label: hub.label,
  description: hub.navDescription,
}));
