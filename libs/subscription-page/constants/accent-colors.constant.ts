export const SUBSCRIPTION_PAGE_ACCENT_COLORS = {
    ROSE: 'rose',
    RUBY: 'ruby',
    EMERALD: 'emerald',
    TEAL: 'teal',
    SKY: 'sky',
    SAPPHIRE: 'sapphire',
    PLUM: 'plum',
    ORCHID: 'orchid',
} as const;

export type TSubscriptionPageAccentColor =
    (typeof SUBSCRIPTION_PAGE_ACCENT_COLORS)[keyof typeof SUBSCRIPTION_PAGE_ACCENT_COLORS];

export const SUBSCRIPTION_PAGE_ACCENT_COLORS_VALUES = Object.values(
    SUBSCRIPTION_PAGE_ACCENT_COLORS,
);

export const SUBSCRIPTION_PAGE_DEFAULT_ACCENT_COLOR: TSubscriptionPageAccentColor =
    SUBSCRIPTION_PAGE_ACCENT_COLORS.ROSE;

export const isSubscriptionPageAccentColor = (
    value: unknown,
): value is TSubscriptionPageAccentColor => {
    return SUBSCRIPTION_PAGE_ACCENT_COLORS_VALUES.includes(value as TSubscriptionPageAccentColor);
};

type TShades = readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
];

/**
 * Shade scales for the subscription page's main colour: index 8 fills buttons (white text must stay
 * readable on it), index 4 is text and icons on the dark page. `hue` tints the page's dark greys, so
 * the whole page leans toward the colour. Rose is the panel's own accent.
 */
export const SUBSCRIPTION_PAGE_ACCENT_PALETTES: Record<
    TSubscriptionPageAccentColor,
    { hue: number; shades: TShades }
> = {
    rose: {
        hue: 326,
        shades: [
            '#FFEEF5',
            '#FFD6E7',
            '#FFB8D4',
            '#FF9AC3',
            '#FF7DB5',
            '#F563A2',
            '#E84D92',
            '#DC4286',
            '#D23A7C',
            '#B42F69',
        ],
    },
    ruby: {
        hue: 352,
        shades: [
            '#FFEDEE',
            '#FFD3D6',
            '#FFB3B8',
            '#FF949B',
            '#FF7A83',
            '#F5606B',
            '#E94A56',
            '#DC3A47',
            '#CF2F3D',
            '#AD2531',
        ],
    },
    emerald: {
        hue: 150,
        shades: [
            '#E9FBF1',
            '#C9F4DC',
            '#9FEBC0',
            '#72DFA3',
            '#4CD38A',
            '#2FC476',
            '#22B067',
            '#1C9E5B',
            '#14854A',
            '#127040',
        ],
    },
    teal: {
        hue: 176,
        shades: [
            '#E4FBF8',
            '#BFF4EE',
            '#8FEBE1',
            '#5DDFD2',
            '#36D1C2',
            '#1FBFB0',
            '#16AA9C',
            '#13968A',
            '#0E8278',
            '#0B6A61',
        ],
    },
    sky: {
        hue: 200,
        shades: [
            '#E6F7FE',
            '#C3ECFC',
            '#95DEFA',
            '#64CEF6',
            '#3ABEF0',
            '#21ACE3',
            '#1899D0',
            '#1587BB',
            '#1178A9',
            '#0D5E85',
        ],
    },
    sapphire: {
        hue: 226,
        shades: [
            '#ECF0FF',
            '#D5DEFF',
            '#B5C5FF',
            '#95ABFF',
            '#7B95FF',
            '#6682FA',
            '#5570F0',
            '#4761E3',
            '#3D55D6',
            '#3044B0',
        ],
    },
    plum: {
        hue: 262,
        shades: [
            '#F3EEFF',
            '#E2D6FF',
            '#CDB8FF',
            '#B591FF',
            '#A07BFA',
            '#8E66F3',
            '#7C4DEB',
            '#7345E0',
            '#6B3FD6',
            '#5B34BA',
        ],
    },
    // No orange: over the dark page it reads brown, which Umiji's palette rules out.
    orchid: {
        hue: 292,
        shades: [
            '#FBEEFF',
            '#F3D6FF',
            '#E8B8FF',
            '#DD9AFB',
            '#D27DF5',
            '#C663EC',
            '#B84DDF',
            '#A940CF',
            '#9A36BF',
            '#7F2C9E',
        ],
    },
};
