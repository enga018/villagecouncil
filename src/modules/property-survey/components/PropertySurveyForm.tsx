'use client';

import { useState } from 'react';
import { Property, PropertySurveyFormData } from '../types';

interface PropertySurveyFormProps {
  vcId: string;
  propertyPrefix: string;
  onSubmit: (data: PropertySurveyFormData) => Promise<void>;
  initialData?: Property;
}

export function PropertySurveyForm({
  vcId,
  propertyPrefix,
  onSubmit,
  initialData,
}: PropertySurveyFormProps) {
  const [formData, setFormData] = useState<PropertySurveyFormData>({
    property_type: initialData?.property_type || '',
    owner_name: initialData?.owner_name || '',
    owner_contact: initialData?.owner_contact || '',
    address: initialData?.address || '',
    latitude: initialData?.latitude || 0,
    longitude: initialData?.longitude || 0,
    occupancy_status: initialData?.occupancy_status || 'occupied',
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name.includes('latitude') || name.includes('longitude') ? parseFloat(value) : value,
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData((prev) => ({
        ...prev,
        photo_file: file,
      }));
    }
  };

  const getLocation = async () => {
    if ('geolocation' in navigator) {
      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject);
        });
        setFormData((prev) => ({
          ...prev,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }));
      } catch (err) {
        setError('Unable to get location. Please enable GPS.');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="bg-red-50 p-3 rounded text-red-700 text-sm">{error}</div>}

      <div>
        <label className="block text-sm font-medium mb-2">Property Type</label>
        <select
          name="property_type"
          value={formData.property_type}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          required
        >
          <option value="">Select property type</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
          <option value="agricultural">Agricultural</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Owner Name</label>
        <input
          type="text"
          name="owner_name"
          value={formData.owner_name}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Contact Number</label>
        <input
          type="tel"
          name="owner_contact"
          value={formData.owner_contact}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Address</label>
        <textarea
          name="address"
          value={formData.address}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          rows={3}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">Latitude</label>
          <input
            type="number"
            name="latitude"
            value={formData.latitude}
            onChange={handleChange}
            step="0.00001"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Longitude</label>
          <input
            type="number"
            name="longitude"
            value={formData.longitude}
            onChange={handleChange}
            step="0.00001"
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={getLocation}
        className="w-full px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
      >
        Get Current Location
      </button>

      <div>
        <label className="block text-sm font-medium mb-2">Photo</label>
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="w-full px-3 py-2 border rounded-lg"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Occupancy Status</label>
        <select
          name="occupancy_status"
          value={formData.occupancy_status}
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
        >
          <option value="occupied">Occupied</option>
          <option value="vacant">Vacant</option>
          <option value="under_construction">Under Construction</option>
          <option value="other">Other</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save Property'}
      </button>
    </form>
  );
}
