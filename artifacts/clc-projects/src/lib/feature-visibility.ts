export type FeatureVisibilityFlag = {
  key: string;
};

export type FeatureNavigationGroup<TItem extends { href: string }> = {
  label: string;
  items: readonly TItem[];
};

export function isAdvertisedFeature(
  featureKey: string,
  featureFlags: readonly FeatureVisibilityFlag[] | undefined,
) {
  return featureFlags?.some((feature) => feature.key === featureKey) ?? false;
}

export function canAccessComingSoonFeature(
  featureKey: string,
  featureFlags: readonly FeatureVisibilityFlag[] | undefined,
  isPlatformAdmin: boolean,
) {
  return isPlatformAdmin || isAdvertisedFeature(featureKey, featureFlags);
}

export function filterFeatureNavigationGroups<
  TItem extends { href: string },
  TGroup extends FeatureNavigationGroup<TItem>,
>(
  groups: readonly TGroup[],
  featureFlags: readonly FeatureVisibilityFlag[] | undefined,
  isPlatformAdmin: boolean,
) {
  const visibleKeys = new Set(featureFlags?.map((feature) => feature.key) ?? []);

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!item.href.startsWith('/coming-soon/')) return true;
        const featureKey = item.href.slice('/coming-soon/'.length);
        return isPlatformAdmin || visibleKeys.has(featureKey);
      }),
    }))
    .filter((group) => group.items.length > 0);
}