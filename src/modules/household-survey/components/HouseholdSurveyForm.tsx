'use client';

import { useState } from 'react';
import { FamilyMember, HouseholdSurveyFormData, Household } from '../types';

interface HouseholdSurveyFormProps {
  properties: Array<{ id: string; property_id: string; address: string }>;
  onSubmit: (data: HouseholdSurveyFormData) => Promise<void>;
  initialData?: Household;
}

export function HouseholdSurveyForm({
  properties,
  onSubmit,
  initialData,
}: HouseholdSurveyFormProps) {
  const [selectedPropertyId, setSelectedPropertyId] = useState(initialData?.property_id || '');
  const [members, setMembers] = useState<FamilyMember[]>(initialData?.members || []);
  const [headOfHousehold, setHeadOfHousehold] = useState(initialData?.head_of_household || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentMember, setCurrentMember] = useState<Partial<FamilyMember>>({
    gender: 'male',
    relation: 'child',
  });

  const addMember = () => {
    if (!currentMember.name || currentMember.age === undefined) {
      setError('Please fill in member name and age');
      return;
    }

    const newMember: FamilyMember = {
      id: `member-${Date.now()}`,
      name: currentMember.name,
      gender: currentMember.gender as FamilyMember['gender'],
      age: currentMember.age,
      relation: currentMember.relation as FamilyMember['relation'],
    };

    setMembers([...members, newMember]);
    setCurrentMember({ gender: 'male', relation: 'child' });
    setError(null);
  };

  const removeMember = (id: string) => {
    setMembers(members.filter((m) => m.id !== id));
  };

  const childrenCount = members.filter((m) => m.relation === 'child').length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!selectedPropertyId || !members.length || !headOfHousehold) {
      setError('Please select property, add members, and set head of household');
      setLoading(false);
      return;
    }

    try {
      await onSubmit({
        property_id: selectedPropertyId,
        members,
        head_of_household: headOfHousehold,
      });
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
        <label className="block text-sm font-medium mb-2">Select Property</label>
        <select
          value={selectedPropertyId}
          onChange={(e) => setSelectedPropertyId(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          required
        >
          <option value="">Choose a property</option>
          {properties.map((prop) => (
            <option key={prop.id} value={prop.id}>
              {prop.property_id} - {prop.address}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-medium mb-4">Add Family Members</h3>

        <div className="space-y-3 mb-4">
          <input
            type="text"
            placeholder="Member name"
            value={currentMember.name || ''}
            onChange={(e) => setCurrentMember({ ...currentMember, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={currentMember.gender || 'male'}
              onChange={(e) =>
                setCurrentMember({ ...currentMember, gender: e.target.value as FamilyMember['gender'] })
              }
              className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>

            <input
              type="number"
              placeholder="Age"
              min="0"
              max="120"
              value={currentMember.age || ''}
              onChange={(e) =>
                setCurrentMember({ ...currentMember, age: parseInt(e.target.value) })
              }
              className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
            />
          </div>

          <select
            value={currentMember.relation || 'child'}
            onChange={(e) =>
              setCurrentMember({ ...currentMember, relation: e.target.value as FamilyMember['relation'] })
            }
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          >
            <option value="head">Head of Household</option>
            <option value="spouse">Spouse</option>
            <option value="child">Child</option>
            <option value="parent">Parent</option>
            <option value="sibling">Sibling</option>
            <option value="other">Other</option>
          </select>
        </div>

        <button
          type="button"
          onClick={addMember}
          className="w-full px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 mb-4"
        >
          Add Member
        </button>

        <div className="bg-gray-50 p-3 rounded mb-4">
          <p className="text-sm font-medium mb-2">Family Members ({members.length})</p>
          <p className="text-xs text-gray-600 mb-3">Children: {childrenCount}</p>

          {members.map((member) => (
            <div key={member.id} className="bg-white p-2 rounded mb-2 flex justify-between items-start">
              <div className="flex-1">
                <p className="font-medium text-sm">{member.name}</p>
                <p className="text-xs text-gray-600">
                  {member.gender} • Age {member.age} • {member.relation}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeMember(member.id)}
                className="text-red-600 text-sm hover:text-red-800"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Head of Household</label>
        <select
          value={headOfHousehold}
          onChange={(e) => setHeadOfHousehold(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2"
          required
        >
          <option value="">Select head of household</option>
          {members.map((member) => (
            <option key={member.id} value={member.name}>
              {member.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? 'Saving...' : 'Save Household'}
      </button>
    </form>
  );
}
