import { Star, Wifi, Utensils, Car, ShieldCheck } from "lucide-react";

interface HeroProps {
  name?: string;
  city?: string;
  country?: string;
  starRating?: number;
}

const Hero = ({ name, city, country, starRating }: HeroProps) => {
  const location = [city, country].filter(Boolean).join(", ");
  return (
    <section className="relative bg-gradient-to-br from-primary-600 via-primary-700 to-primary-800 overflow-hidden">
      <div className="absolute inset-0 bg-grid-white/[0.02] bg-[size:60px_60px]" />
      <div className="absolute inset-0 bg-gradient-to-r from-primary-600/20 to-transparent" />

      <div className="absolute top-20 left-20 w-32 h-32 bg-white/5 rounded-full blur-xl animate-bounce-gentle" />
      <div
        className="absolute bottom-20 right-20 w-24 h-24 bg-white/5 rounded-full blur-xl animate-bounce-gentle"
        style={{ animationDelay: "1s" }}
      />

      <div className="w-full px-4 sm:px-6 lg:px-8 pt-16 pb-16 relative">
        <div className="text-center max-w-4xl mx-auto">
          {starRating ? (
            <div className="inline-flex items-center bg-white/10 backdrop-blur-sm rounded-full px-6 py-2 mb-8">
              <Star className="w-5 h-5 text-yellow-400 mr-2" />
              <span className="text-white/90 font-medium">
                {starRating}-Star {name ?? "Hotel"}
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center bg-white/10 backdrop-blur-sm rounded-full px-6 py-2 mb-8">
              <Star className="w-5 h-5 text-yellow-400 mr-2" />
              <span className="text-white/90 font-medium">
                Welcome
              </span>
            </div>
          )}

          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
            {name ?? "Your Perfect"}
            <span className="block bg-gradient-to-r from-yellow-400 to-orange-400 bg-clip-text text-transparent">
              {name ? "Awaits You" : "Dream Stay"}
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-white/90 mb-12 leading-relaxed">
            {location ? (
              <>Located in {location}. Book directly with confidence.</>
            ) : (
              <>Book directly with confidence and enjoy an unforgettable stay.</>
            )}
          </p>

          <div className="flex justify-center items-center flex-wrap gap-x-8 gap-y-4">
            <div className="flex items-center text-white/80">
              <Wifi className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Free Wi-Fi</span>
            </div>
            <div className="flex items-center text-white/80">
              <Utensils className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">On-site Dining</span>
            </div>
            <div className="flex items-center text-white/80">
              <Car className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Parking</span>
            </div>
            <div className="flex items-center text-white/80">
              <ShieldCheck className="w-5 h-5 mr-2" />
              <span className="text-sm font-medium">Secure Booking</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
