type NamedFile = { name: string; type: string };

/** Formats the cut editor can play and cut in the browser. */
const EDITOR_MEDIA_EXTENSION = /\.(wav|mp3|m4a|mp4|webm|ogg|flac|mov|m4v|mkv|aac)$/i;
/** Extensions shown with an audio player instead of a video player. */
const AUDIO_ONLY_EXTENSION = /\.(wav|mp3|m4a|flac|ogg)$/i;
/** Recognition also accepts containers that only the server-side FFmpeg can decode. */
const RECOGNITION_MEDIA_EXTENSION = /\.(mp4|mov|mkv|webm|avi|m4v|wmv|mts|m2ts|wav|mp3|m4a|ogg|flac|aac)$/i;

export const isEditorMediaFile = (file: NamedFile) => /^(audio|video)\//.test(file.type) || EDITOR_MEDIA_EXTENSION.test(file.name);

export const isAudioOnlyFile = (file: NamedFile) => file.type.startsWith("audio/") || AUDIO_ONLY_EXTENSION.test(file.name);

export const isRecognitionMediaName = (name: string) => RECOGNITION_MEDIA_EXTENSION.test(name);
