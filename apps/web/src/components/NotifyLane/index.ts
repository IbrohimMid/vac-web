import { PersistentRail, StickyBanners, TransientToasts } from './NotifyLanes';

export const NotifyLanes = {
  Transient: TransientToasts,
  Persistent: PersistentRail,
  Sticky: StickyBanners,
};

export { PersistentRail, StickyBanners, TransientToasts };
