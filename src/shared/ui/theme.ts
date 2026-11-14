// Shared foundation, retaining the archive's existing blue and neutral palette.
export const theme = {
  colors: {
    background: '#f7f8fa', surface: '#ffffff', ink: '#17283b', text: '#34465a',
    muted: '#52657a', primary: '#183e63', selected: '#e6eef3', border: '#d7dee6', error: '#a12626',
  },
  space: { small: 8, medium: 12, large: 16, page: 20 },
  radius: { control: 8, card: 12 },
} as const;
