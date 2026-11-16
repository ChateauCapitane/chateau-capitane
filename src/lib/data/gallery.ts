export type PhotoGroup = {
  id: string;
  name: string;
  description?: string;
  photos: Photo[];
};

export type Photo = {
  id: string;
  /** Specific alt text — used as the placeholder label until a photo exists. */
  alt: string;
  /** Shown under the photo. */
  caption?: string;
  aspect: string;
  /** Spans two columns on wide screens, for visual rhythm. */
  feature?: boolean;
  /**
   * Path under /public. While undefined, the grid renders a labelled
   * placeholder at the same aspect ratio — add the path and the photo appears
   * with no other change.
   */
  src?: string;
};

const groups: PhotoGroup[] = [
  {
    id: "rooms",
    name: "The rooms",
    description:
      "The dining room, the bar, and the spaces we set aside for parties.",
    photos: [
      {
        id: "dining-room-full",
        alt: "The main dining room with tables set for dinner service",
        aspect: "aspect-3/2",
        feature: true,
      },
      {
        id: "bar",
        alt: "The bar with bottles lit from behind",
        aspect: "aspect-3/4",
      },
      {
        id: "dining-room-detail",
        alt: "A set table with linen, glassware, and bread",
        aspect: "aspect-3/4",
      },
      {
        id: "entrance",
        alt: "The entrance on Coney Island Avenue at dusk",
        aspect: "aspect-3/4",
      },
    ],
  },
  {
    id: "private-events",
    name: "Private events",
    description:
      "Banquet tables laid for birthdays, anniversaries, and family gatherings.",
    photos: [
      {
        id: "banquet-platters",
        alt: "Family-style platters served at a banquet",
        aspect: "aspect-square",
        src: "/photos/banquet-platters.jpg",
      },
      {
        id: "banquet-long-table",
        alt: "A long banquet table laid with the full cold course",
        aspect: "aspect-3/2",
        feature: true,
      },
      {
        id: "private-room",
        alt: "The private dining room arranged for a seated party",
        aspect: "aspect-4/3",
      },
      {
        id: "cold-table",
        alt: "Cold appetizers and salads covering a banquet table",
        aspect: "aspect-4/3",
      },
      {
        id: "kids-party",
        alt: "A children’s party table set for the kids banquet",
        aspect: "aspect-4/3",
      },
      {
        id: "toast",
        alt: "Guests raising a toast at a banquet",
        aspect: "aspect-4/3",
      },
    ],
  },
  {
    id: "kitchen",
    name: "From the kitchen",
    description: "What comes out of it.",
    photos: [
      {
        id: "lobster-platter",
        alt: "Whole lobster with red caviar, greens, and lemon on a white platter",
        aspect: "aspect-4/5",
        src: "/photos/lobster-platter-instagram.jpg",
      },
      {
        id: "chilean-sea-bass",
        alt: "Chilean sea bass",
        aspect: "aspect-square",
        src: "/photos/chilean-sea-bass.jpg",
      },
      {
        id: "chicken-tabaka",
        alt: "Chalakhach chicken tabaka with mashed potatoes and pickled red onion",
        aspect: "aspect-square",
        src: "/photos/chicken-tabaka.jpg",
      },
      {
        id: "beef-tartare",
        alt: "Beef tartare",
        aspect: "aspect-square",
        src: "/photos/beef-tartare.jpg",
      },
      {
        id: "borscht",
        alt: "A bowl of borscht with sour cream and dill",
        aspect: "aspect-square",
        src: "/photos/borscht.jpg",
      },
      {
        id: "lulya-kebab",
        alt: "Lyulya kebab with grilled vegetables and sauce",
        aspect: "aspect-square",
        src: "/photos/lulya-kebab.jpg",
      },
      {
        id: "caviar",
        alt: "Red caviar served with blini and accompaniments at a banquet table",
        aspect: "aspect-4/5",
        src: "/photos/caviar-service-instagram.jpg",
      },
      {
        id: "mixed-carpaccio",
        alt: "Mixed carpaccio",
        aspect: "aspect-square",
        src: "/photos/mixed-carpaccio.jpg",
      },
      {
        id: "t-bone-steak",
        alt: "Prime T-bone steak with red wine",
        aspect: "aspect-square",
        src: "/photos/t-bone-steak.jpg",
      },
      {
        id: "salmon-tartare",
        alt: "Salmon tartare",
        aspect: "aspect-square",
        src: "/photos/salmon-tartare.jpg",
      },
      {
        id: "sesame-tuna",
        alt: "Sesame tuna",
        aspect: "aspect-4/5",
        src: "/photos/sesame-tuna.jpg",
      },
      {
        id: "mushroom-napoleon",
        alt: "Truffle mushroom Napoleon",
        aspect: "aspect-4/5",
        src: "/photos/mushroom-napoleon.jpg",
      },
    ],
  },

];

/** Aspect-ratio classes a photo may use (uploads pick the nearest). */
export const PHOTO_ASPECTS = ["aspect-3/2", "aspect-4/3", "aspect-square", "aspect-4/5", "aspect-3/4"] as const;

export function getPhotoGroups(): PhotoGroup[] {
  return groups;
}

export function hasGalleryPhotos(photoGroups: PhotoGroup[] = groups): boolean {
  return photoGroups.some((group) =>
    group.photos.some((photo) => photo.src !== undefined),
  );
}
