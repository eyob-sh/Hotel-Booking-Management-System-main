import { Star, Wifi, Utensils, Car, ShieldCheck, MapPin } from "lucide-react";

interface HeroProps {
  name?: string;
  city?: string;
  country?: string;
  starRating?: number;
}

const Hero = ({ name, city, country, starRating }: HeroProps) => {
  const location = [city, country].filter(Boolean).join(", ");
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary-700 via-primary-600 to-indigo-600">
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -right-16 w-[28rem] h-[28rem] bg-indigo-400/20 rounded-full blur-3xl" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 md:pt-28 md:pb-32">
        <div className="text-center max-w-3xl mx-auto">
          {starRating ? (
            <div className="inline-flex items-center bg-white/15 backdrop-blur-sm rounded-full px-5 py-2 mb-8 border border-white/20 shadow-soft">
              <Star className="w-5 h-5 text-yellow-300 mr-2 fill-yellow-300" />
              <span className="text-white/95 font-medium">
                {starRating}-Star {name ?? "Hotel"}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center bg-white/15 backdrop-blur-sm rounded-full px-5 py-2 mb-8 border border-white/20">
              <Star className="w-5 h-5 text-yellow-300 mr-2 fill-yellow-300" />
              <span className="text-white/95 font-medium">Welcome</span>
            </div>
          )}

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white mb-6 leading-tight tracking-tight">
            {name ?? "Your Perfect"}
            <span className="block mt-2 bg-gradient-to-r from-yellow-300 to-orange-300 bg-clip-text text-transparent">
              {name ? "Awaits You" : "Dream Stay"}
            </span>
          </h1>

          <p className="text-lg md:text-xl text-white/90 mb-10 leading-relaxed">
            {location ? (
              <>
                <MapPin className="inline w-5 h-5 mr-1 -mt-1" />
                Located in {location}. Book directly with confidence.
              </>
            ) : (
              <>Book directly with confidence and enjoy an unforgettable stay.</>
            )}
          </p>

          <div className="flex flex-wrap justify-center gap-3 mb-12">
            {[
              { icon: Wifi, label: "Free Wi-Fi" },
              { icon: Utensils, label: "On-site Dining" },
              { icon: Car, label: "Parking" },
              { icon: ShieldCheck, label: "Secure Booking" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/15 text-white/90 text-sm font-medium px-4 py-2 rounded-full"
              >
                <Icon className="w-4 h-4" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
EOF
file_path: src/components/Hero.tsx