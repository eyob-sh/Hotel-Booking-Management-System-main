import { useQuery } from "react-query";
import { Link } from "react-router-dom";
import { Users, BedDouble, ArrowRight } from "lucide-react";
import * as apiClient from "../api-client";
import Hero from "../components/Hero";

const Home = () => {
  const { data: hotels, isLoading } = useQuery("fetchHotels", () =>
    apiClient.fetchHotels()
  );

  const property = hotels?.[0];

  const { data: detail } = useQuery(
    ["fetchHotelDetail", property?._id],
    () => apiClient.fetchHotelById(property!._id),
    { enabled: !!property?._id }
  );

  const roomTypes = detail?.roomTypes ?? [];

  return (
    <>
      <Hero
        name={property?.name}
        city={property?.city}
        country={property?.country}
        starRating={property?.starRating}
      />

      <div className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        {isLoading ? (
          <p className="text-center text-gray-500">Loading property...</p>
        ) : !property ? (
          <div className="text-center py-16">
            <h2 className="text-2xl font-semibold text-gray-900 mb-2">
              No property available yet
            </h2>
            <p className="text-gray-600">
              The property has not been set up. Please check back later.
            </p>
          </div>
        ) : (
          <>
            {/* About the property */}
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-bold text-gray-900 mb-3">
                {property.name}
              </h2>
              <p className="text-gray-600 leading-relaxed">
                {property.description}
              </p>
            </div>

            {/* Rooms & Rates */}
            <div>
              <div className="flex items-end justify-between mb-6">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900">
                    Rooms &amp; Rates
                  </h3>
                  <p className="text-gray-600">
                    Choose a room type and book your stay
                  </p>
                </div>
                <Link
                  to={`/detail/${property._id}`}
                  className="hidden sm:flex items-center text-primary-600 font-semibold hover:text-primary-700"
                >
                  View details
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </div>

              {roomTypes.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-300 rounded-xl">
                  <p className="text-gray-600">
                    Room types will appear here once configured.
                  </p>
                  <Link
                    to={`/detail/${property._id}`}
                    className="inline-flex items-center mt-4 text-primary-600 font-semibold hover:text-primary-700"
                  >
                    View property
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {roomTypes.map((rt) => (
                    <div
                      key={rt._id}
                      className="group bg-white rounded-2xl shadow-soft hover:shadow-large transition-all duration-300 overflow-hidden flex flex-col border border-gray-100 hover:-translate-y-1"
                    >
                      <div className="h-48 bg-gray-100 overflow-hidden">
                        {rt.photos?.[0] ? (
                          <img
                            src={rt.photos[0]}
                            alt={rt.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <BedDouble className="w-10 h-10" />
                          </div>
                        )}
                      </div>
                      <div className="p-5 flex flex-col flex-1">
                        <h4 className="text-lg font-semibold text-gray-900">
                          {rt.name}
                        </h4>
                        {rt.description && (
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                            {rt.description}
                          </p>
                        )}
                        <div className="flex items-center text-sm text-gray-500 mt-3">
                          <Users className="w-4 h-4 mr-1" />
                          Up to {rt.maxAdults} adults
                          {rt.maxChildren > 0 ? `, ${rt.maxChildren} children` : ""}
                        </div>
                        <div className="mt-4 flex items-end justify-between flex-1">
                          <div>
                            <span className="text-2xl font-bold text-gray-900">
                              ETB {rt.basePrice.toLocaleString()}
                            </span>
                            <span className="text-sm text-gray-500">
                              {" "}
                              / night
                            </span>
                          </div>
                          <Link
                            to={`/detail/${property._id}`}
                            className="inline-flex items-center bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition-colors"
                          >
                            Book
                            <ArrowRight className="w-4 h-4 ml-1" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default Home;
