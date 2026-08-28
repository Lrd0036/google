import loudoun from '../../loudoun_data_centers.json';

export type LoudounFacility = {
  id: string;
  name: string;
  operator: string;
  address: string;
  city: string;
  lat: number;
  lon: number;
};

type LoudounFile = {
  metadata: { count: number; disclaimer: string };
  facilities: LoudounFacility[];
};

const data = loudoun as LoudounFile;

export const LOUDOUN_FACILITIES: readonly LoudounFacility[] = data.facilities;

export const LOUDOUN_COUNT = LOUDOUN_FACILITIES.length;

const LABEL_IDS = new Set([
  'equinix-dc2',
  'aws-iad71',
  'digital-iad35',
  'vantage-va12',
  'aws-iad140',
  'centersquare-iad1a',
]);

export function isLabeledFacility(id: string) {
  return LABEL_IDS.has(id);
}

export const ALLEY_CENTER: [number, number] = [
  LOUDOUN_FACILITIES.reduce((sum, site) => sum + site.lon, 0) / LOUDOUN_COUNT,
  LOUDOUN_FACILITIES.reduce((sum, site) => sum + site.lat, 0) / LOUDOUN_COUNT,
];
