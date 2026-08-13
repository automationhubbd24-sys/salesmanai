import { useEffect } from "react";

interface SEOProps {
  title?: string;
  description?: string;
  noindex?: boolean;
}

const setMeta = (name: string, content: string) => {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
};

const SEO = ({ title, description, noindex = false }: SEOProps) => {
  useEffect(() => {
    if (title) document.title = title;
    if (description) setMeta("description", description);

    if (noindex) {
      setMeta("robots", "noindex, nofollow, noarchive, nosnippet");
      setMeta("googlebot", "noindex, nofollow, noarchive, nosnippet");
    } else {
      setMeta("robots", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1");
      setMeta("googlebot", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1");
    }
  }, [title, description, noindex]);

  return null;
};

export default SEO;
