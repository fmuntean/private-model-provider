// Core Gemini API TypeScript interfaces

export interface InteractionRequest {
  id: string;
  model: string;
  input: Content | Content[] | Step[] | string;
  system_instruction?: string;
  tools?: Tool[];
  response_format?: ResponseFormat | ResponseFormat[];
  stream?: boolean;
  store?: boolean;
  background?: boolean;
  generation_config?: GenerationConfig;
  cached_content?: string;
  previous_interaction_id?: string;
}

export interface InteractionResponse {
  id: string;
  model: string;
  status: GeminiStatus;
  created?:string;
  updated?:string;
  system_instruction?: string;
  tools?: Tool[];
  usage?: GeminiUsage;
  output: Content | Content[];
  cached_content?: string;
  previous_interaction_id?: string;
  next_interaction_id?: string;
  output_text?: string;
  output_image?: ImageContent;
  output_audio?: AudioContent;
  output_document?: DocumentContent;
}

export type Step = 'model_output' | 'thought' | 'function_call' | 'code_execution' | 'url_context' | 'google_search' | 'file_search' | 'google_maps';
export type GeminiStatus = 'success' | 'failed' | 'in_progress' | 'cancelled'| 'requires_action' | 'completed' | 'incomplete';

export interface GeminiUsage {
  total_input_tokens?: number;
  input_tokens_by_modality?: Record<string, number>;
  total_cached_tokens?: number;
  cached_tokens_by_modality?: Record<string, number>;
  total_tool_use_tokens?: number;
  tool_use_tokens_by_modality?: Record<string, number>;
  total_tought_tokens?: number;
  total_tokens?: number;
  grounding_tool_count?: Record<string, number>;
}

export interface Tool {
  type: string; // e.g., 'function', 'code_execution', 'url_context', 'google_search', 'file_search', 'google_maps'
  name: string;
  description: string;
  parameters?: any; // JSON schema for tool parameters
}

export interface ResponseFormat {
  type: 'json_schema' | 'text' | 'image' | 'audio' | 'document';
  schema?: any; // JSON schema for the response format
}

export interface GenerationConfig {
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop_sequences?: string[];  
}

export type Content = TextContent | ImageContent | AudioContent | DocumentContent | VideoContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string; // base64 encoded
  mime_type: string;
}

export interface AudioContent {
  type: 'audio';
  data: string; // base64 encoded
  mime_type: string;
}

export interface DocumentContent {
  type: 'document';
  data: string; // base64 encoded
  mime_type: string;
}

export interface VideoContent {
  type: 'video';
  uri: string; //url for video content
  mime_type?: string;
}